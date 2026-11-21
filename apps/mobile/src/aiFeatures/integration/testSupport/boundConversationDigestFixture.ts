import { captureConversationSources } from '../captureConversationSources';
import { bindConversationSources } from '../conversationSourceBindings';
import { createBoundConversationCaptureOwner } from '../boundConversationCapture';
import { registerBoundCaptureAuthority } from '../boundCaptureAuthority';
import { restoreConversationParentSource } from '../restoreConversationParentSource';
import * as evidence from '../evidenceUtils';
import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import type { ConversationArtifact } from '../../../storage/conversationArtifactCodec';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { SqlResult, SqlValue } from '@orot/storage';

export function gate() {
  let release!: () => void;
  const wait = new Promise<void>(resolve => {
    release = resolve;
  });
  return { wait, release };
}

export async function boundConversationDigestFixture() {
  const f = await diverseHistoryProfileFixture(3, true);
  const { storage, input, database } = f;
  const registry = input.registry;
  const signal = new AbortController().signal;
  const inner = (await storage.read('turn-0'))!;
  const parent = (await storage.read('turn-2'))!;
  const revision = evidence.fingerprint(inner);
  const reference: EvidenceReference = {
    sourceKind: 'generated_artifact',
    sourceId: inner.id,
    evidenceId: inner.id,
    sourceRevision: revision,
    evidenceRevision: revision,
    locator: { kind: 'generated_artifact', type: 'conversation_turn' },
    effectiveTime: null,
    reviewState: 'unreviewed',
  };
  const alias = await restoreConversationParentSource(
    { kind: 'generated_conversation', reference, id: inner.id, revision },
    registry,
    await input.loadLocalData(),
    signal,
    async () => ({ revision, sourceStatus: 'current' }),
  );
  const owner = createBoundConversationCaptureOwner({ storage, registry });
  registerBoundCaptureAuthority(
    owner,
    { read: storage.read },
    storage,
    registry,
  );
  const bind = (
    value: ConversationArtifact,
    expected = evidence.fingerprint(value),
  ) =>
    bindConversationSources({
      citations: [alias!.reference],
      parentId: value.id,
      parentRevision: expected,
      storage,
      registry,
      captureOwner: owner,
    })![0]!;
  const capture = (refs: readonly EvidenceReference[], abort = signal) =>
    captureConversationSources(refs, registry, abort);
  /** Observe native-style top-level execute on the same SQLite connection. */
  const observeRoots = (
    ids: ReadonlySet<string>,
    afterSelect?: (
      id: string,
      ordinal: number,
      returned: number,
      row?: SqlResult['rows'][number],
    ) => Promise<void>,
    beforeQuery?: (query: string, parameters?: SqlValue[]) => Promise<void>,
  ) => {
    const counts: string[] = [];
    const transaction = database.transaction.bind(database);
    database.transaction = work =>
      transaction(async tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = async (query, parameters) => {
          await beforeQuery?.(query, parameters);
          const result = await execute(query, parameters);
          const id = parameters?.[0];
          if (
            typeof id === 'string' &&
            ids.has(id) &&
            query.startsWith(
              'SELECT a.id, a.session_id, a.created_at, a.result_json',
            )
          ) {
            counts.push(id);
            await afterSelect?.(
              id,
              counts.length,
              result.rows.length,
              result.rows[0],
            );
          }
          return result;
        };
        await work(tx);
      });
    return {
      counts,
      restore: () => {
        database.transaction = transaction;
      },
    };
  };
  return { ...f, parent, bind, capture, observeRoots };
}
