import { conversationToolSnapshotReader } from './conversationToolSnapshot';
import { committedPeriodReadOperation } from './committedPeriodReadOperation';
import type { ReadOnlyPeriodValidation } from './readOnlyPeriodValidation';
import type { SqlExecutor } from '@orot/storage';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import { createReadOnlyPeriodValidation } from './readOnlyPeriodValidation';
import type { SqlDatabase } from '@orot/storage';
import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from './conversationArtifactCodec';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';

/** Validate a page in one transaction so hide, clear, or source deletion cannot split its snapshot. */
export function createConversationArtifactReader(
  database: SqlDatabase,
  ensure: () => Promise<void>,
  readToolTurnsSnapshot: ReturnType<typeof conversationToolSnapshotReader>,
) {
  const readManyWithLease = async (
    ids: readonly string[],
    lease?: { readonly sessionId: string; readonly version: number },
    collectValidated?: (artifact: ConversationArtifact) => void,
    operation?: ReturnType<typeof committedPeriodReadOperation>,
    rollbackOnFailure = false,
  ): Promise<(ConversationArtifact | null)[]> => {
    await ensure();
    const output: (ConversationArtifact | null)[] = [];
    const work = async (
      tx: SqlExecutor,
      calculate?: ReadOnlyPeriodValidation,
    ) => {
      // Source validation may record non-destructive quarantine audit state.
      // Only identical period calculations, never that policy authority, are shared.
      const validatePeriod = createReadOnlyPeriodValidation(tx, calculate);
      if (lease) {
        const session = await tx.execute(
          'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ?',
          [lease.sessionId, lease.version],
        );
        if (!session.rows.length)
          throw new Error('Conversation is unavailable.');
      }
      for (const id of ids) {
        const row = await tx.execute(
          'SELECT a.id, a.session_id, a.created_at, a.result_json FROM conversation_artifacts a JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0 JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE a.id = ? AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = a.id)',
          [id],
        );
        const value = decodeConversationArtifact(row.rows[0]?.result_json);
        if (
          !value ||
          value.id !== row.rows[0]?.id ||
          value.sessionId !== row.rows[0]?.session_id ||
          value.createdAt !== row.rows[0]?.created_at ||
          (lease && value.sessionId !== lease.sessionId)
        ) {
          output.push(null);
          continue;
        }
        try {
          await assertConversationArtifactCurrent(
            tx,
            database,
            value,
            false,
            validatePeriod,
            collectValidated,
          );
          output.push(value);
        } catch (error) {
          // Only proven invalid lineage is unavailable; operational failures remain retryable.
          if (!(error instanceof RetainedSourceInvalidError)) throw error;
          output.push(null);
        }
      }
    };
    if (operation?.active) await operation.run(work, { rollbackOnFailure });
    else await database.transaction(work);
    return output;
  };
  const methods = (
    operation?: ReturnType<typeof committedPeriodReadOperation>,
    rollbackOnFailure = false,
  ) => {
    const readMany = (ids: readonly string[]) =>
      readManyWithLease(
        ids,
        undefined,
        undefined,
        operation,
        rollbackOnFailure,
      );
    return {
      readMany,
      async readManyWithAncestry(ids: readonly string[]) {
        // Publish the graph only after the protected transaction commits. This is
        // a page-local snapshot, never authority for live source reads or later requests.
        const ancestry = new Map<string, ConversationArtifact>();
        const items = await readManyWithLease(
          ids,
          undefined,
          artifact => {
            const existing = ancestry.get(artifact.id);
            if (existing && fingerprint(existing) !== fingerprint(artifact))
              throw new Error(
                'Conversation ancestry changed inside its snapshot.',
              );
            ancestry.set(artifact.id, artifact);
          },
          operation,
          rollbackOnFailure,
        );
        return {
          items,
          ancestry: ancestry as ReadonlyMap<string, ConversationArtifact>,
        };
      },
      // Lease and content must share one snapshot, including when the page is empty.
      readSessionMany(
        sessionId: string,
        version: number,
        ids: readonly string[],
      ) {
        return readManyWithLease(
          ids,
          { sessionId, version },
          undefined,
          operation,
          rollbackOnFailure,
        );
      },
      async read(id: string) {
        return (await readMany([id]))[0] ?? null;
      },
    };
  };
  const base = methods();
  return {
    ...base,
    /** Explicit read-only operation; escaped methods revert to strict after disposal. */
    beginReadOperation(
      this: typeof base & {
        readToolTurnsSnapshot: typeof readToolTurnsSnapshot;
        beginReadOperation?: unknown;
      },
      signal?: AbortSignal,
      options?: { readonly rollbackOnFailure?: boolean },
    ) {
      const entry = this?.beginReadOperation;
      // A wrapper replacing any read boundary must retain its strict custom path,
      // including replacements made while an operation is awaiting hydration.
      const owned = () =>
        Boolean(
          this &&
          this.readMany === base.readMany &&
          this.readManyWithAncestry === base.readManyWithAncestry &&
          this.readSessionMany === base.readSessionMany &&
          this.read === base.read &&
          this.readToolTurnsSnapshot === readToolTurnsSnapshot &&
          this.beginReadOperation === entry,
        );
      if (!owned()) return undefined;
      const operation = committedPeriodReadOperation(database, signal);
      const scoped = methods(operation, options?.rollbackOnFailure);
      const toolSnapshot = conversationToolSnapshotReader(
        database,
        ensure,
        operation,
      );
      return {
        get healthContextReportScope() {
          return owned() && operation.active
            ? operation.reportScope
            : undefined;
        },
        readToolTurnsSnapshot: (
          ...args: Parameters<typeof readToolTurnsSnapshot>
        ) =>
          (owned() && operation.active
            ? toolSnapshot
            : this.readToolTurnsSnapshot)(...args),
        readMany: (ids: readonly string[]) =>
          (owned() ? scoped : this).readMany(ids),
        readManyWithAncestry: (ids: readonly string[]) =>
          (owned() ? scoped : this).readManyWithAncestry(ids),
        readSessionMany: (
          id: string,
          version: number,
          ids: readonly string[],
        ) => (owned() ? scoped : this).readSessionMany(id, version, ids),
        read: (id: string) => (owned() ? scoped : this).read(id),
        dispose: operation.dispose,
      };
    },
  };
}
