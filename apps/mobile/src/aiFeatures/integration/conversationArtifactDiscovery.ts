import type { SqlDatabase } from '@orot/storage';
import type {
  ArtifactDiscovery,
  ArtifactMetadata,
} from '../../healthEvidence/artifactDiscovery';
import type { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { restoreConversationArtifact } from './restoreConversationArtifact';
import { fingerprint } from './evidenceUtils';

type Metadata = ArtifactMetadata & { readonly type: 'conversation_turn' };
type Content = { readonly question: string; readonly answer: string };
function cursor(value: string | undefined): number | null {
  if (value === undefined) return null;
  if (!/^[1-9]\d{0,15}$/u.test(value))
    throw new RangeError('Invalid conversation cursor.');
  const key = Number(value);
  if (!Number.isSafeInteger(key))
    throw new RangeError('Invalid conversation cursor.');
  return key;
}

/** Search the authoritative encrypted store, revalidating every result before matching private text. */
export function createConversationArtifactDiscovery(input: {
  readonly database: SqlDatabase;
  readonly storage: ReturnType<typeof createConversationArtifactStorage>;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly data: AiFeatureLocalData;
}): ArtifactDiscovery<Metadata, Content> {
  const read = async (id: string, signal = new AbortController().signal) => {
    const saved = await restoreConversationArtifact({ ...input, id, signal });
    if (!saved) return null;
    const metadata: Metadata = {
      type: 'conversation_turn',
      id: saved.id,
      originFeature: 'record_conversation',
      originSession: saved.sessionId,
      createdAt: saved.createdAt,
      eventTime: null,
      revision: saved.revision,
      providerId: saved.providerId,
      modelId: saved.modelId,
      completion: saved.status,
      review: 'unreviewed',
    };
    return {
      metadata,
      content: { question: saved.question, answer: saved.answer },
      sources: saved.sources,
      sourceStatus: saved.sourceStatus,
    };
  };
  return {
    read,
    async search({ query, cursor: next, limit, signal }) {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 20 ||
        query.length > 240 ||
        (next && next.length > 16)
      )
        throw new RangeError('Invalid conversation search.');
      if (signal?.aborted)
        throw new Error('Conversation search was cancelled.');
      const before = cursor(next);
      await input.storage.currentGeneration();
      const result = await input.database.execute(
        'SELECT rowid AS scan_key, id FROM conversation_artifacts WHERE (? IS NULL OR rowid < ?) ORDER BY rowid DESC LIMIT ?',
        [before, before, limit + 1],
      );
      const rows = result.rows.slice(0, limit);
      const items: Metadata[] = [];
      let unavailableCount = 0;
      const needle = query.trim().normalize('NFKC').toLowerCase();
      for (const row of rows) {
        if (
          typeof row.id !== 'string' ||
          typeof row.scan_key !== 'number' ||
          !Number.isSafeInteger(row.scan_key) ||
          row.scan_key < 1
        )
          throw new Error('Invalid conversation identity.');
        const saved = await input.storage.read(row.id);
        if (!saved || saved.citations === undefined) {
          unavailableCount += 1;
          continue;
        }
        if (
          !needle ||
          `${saved.question} ${saved.answer}`
            .normalize('NFKC')
            .toLowerCase()
            .includes(needle)
        ) {
          const detail = await read(row.id, signal);
          if (detail && detail.metadata.revision === fingerprint(saved))
            items.push(detail.metadata);
          else unavailableCount += 1;
        }
      }
      if (signal?.aborted)
        throw new Error('Conversation search was cancelled.');
      const last = rows.at(-1);
      return {
        items,
        unavailableCount,
        nextCursor:
          result.rows.length > limit && last ? String(last.scan_key) : null,
      };
    },
  };
}
