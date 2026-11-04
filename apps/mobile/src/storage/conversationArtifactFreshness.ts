import {
  createManualHistoryRepository,
  type SqlDatabase,
  type SqlExecutor,
} from '@orot/storage';
import {
  isGeneratedConversationSource,
  isGeneratedSummarySource,
} from '../ragConversation/conversationArtifactSources';
import { fingerprint } from '../aiFeatures/integration/evidenceUtils';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from './conversationArtifactCodec';
import { assertConversationSourcesNotRemoved } from './conversationArtifactDependencies';
import { assertConversationSummaryParent } from './conversationSummaryParent';
import { assertRetainedEvidenceCurrent } from './retainedEvidenceFreshness';

/** Validate a bounded ancestry in one transaction, rejecting cycles and unavailable parents. */
export async function assertConversationArtifactCurrent(
  tx: SqlExecutor,
  database: SqlDatabase,
  artifact: ConversationArtifact,
  requireGeneration: boolean,
) {
  const history = createManualHistoryRepository(database);
  const path = new Set<string>();
  let visited = 0;
  const visit = async (current: ConversationArtifact): Promise<void> => {
    if (path.has(current.id) || path.size >= 16 || ++visited > 128)
      throw new RetainedSourceInvalidError(
        'Conversation ancestry is cyclic or too large.',
      );
    path.add(current.id);
    await assertConversationSourcesNotRemoved(tx, current);
    for (const source of current.sources) {
      if (isGeneratedSummarySource(source)) {
        await assertConversationSummaryParent(tx, database, source);
      } else if (isGeneratedConversationSource(source)) {
        const result = await tx.execute(
          `SELECT a.result_json, a.id, a.session_id, a.created_at FROM conversation_artifacts a
          JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0
          JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation
          WHERE a.id = ? AND NOT EXISTS (SELECT 1 FROM conversation_invalid_parents i WHERE i.id = a.id) AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = a.id)`,
          [source.id],
        );
        const row = result.rows[0];
        const parent = decodeConversationArtifact(row?.result_json);
        if (
          !parent ||
          parent.id !== row?.id ||
          parent.sessionId !== row.session_id ||
          parent.createdAt !== row.created_at ||
          parent.citations === undefined ||
          fingerprint(parent) !== source.revision
        )
          throw new RetainedSourceInvalidError(
            'The generated conversation changed or was removed.',
          );
        await visit(parent);
      } else {
        // Existing parents keep scoped deletion guards rather than a new turn's global lease.
        await assertRetainedEvidenceCurrent(
          tx,
          [source],
          history,
          requireGeneration && path.size === 1,
        );
      }
    }
    path.delete(current.id);
  };
  await visit(artifact);
}
