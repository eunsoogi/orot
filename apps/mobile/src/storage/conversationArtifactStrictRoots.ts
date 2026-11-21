import type { SqlDatabase, SqlExecutor } from '@orot/storage';
import { measureHistoryValidationCost } from '../providers/conversationHistoryDiagnostic';
import { RetainedSourceInvalidError } from '../aiFeatures/integration/retainedSourceError';
import type { committedPeriodReadOperation } from './committedPeriodReadOperation';
import { createConversationReadDiagnostics } from './conversationReadDiagnostics';
import {
  createReadOnlyPeriodValidation,
  type ReadOnlyPeriodValidation,
} from './readOnlyPeriodValidation';
import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from './conversationArtifactCodec';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';

/** Preserve every original strict root and source validation in its existing transaction. */
export function createConversationStrictRoots(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async (
    ids: readonly string[],
    lease?: { readonly sessionId: string; readonly version: number },
    collectValidated?: (artifact: ConversationArtifact) => void,
    operation?: ReturnType<typeof committedPeriodReadOperation>,
    rollbackOnFailure = false,
    canBatchOrdinary?: () => boolean,
    recordRootBytes?: (raw?: string) => void,
  ): Promise<(ConversationArtifact | null)[]> => {
    const diagnostic = createConversationReadDiagnostics(
      Boolean(operation?.active && operation.profileHistoryValidation),
    );
    try {
      diagnostic.start('artifact_read_setup');
      await ensure();
      diagnostic.finish();
      const output: (ConversationArtifact | null)[] = [];
      const work = async (
        tx: SqlExecutor,
        calculate?: ReadOnlyPeriodValidation,
      ) => {
        diagnostic.finish();
        // Source validation may record non-destructive quarantine audit state.
        // Only identical period calculations, never that policy authority, are shared.
        const validatePeriod = createReadOnlyPeriodValidation(tx, calculate);
        if (lease) {
          diagnostic.start('artifact_session_lease');
          const { rows } = await tx.execute(
            'SELECT s.id FROM conversation_artifact_sessions s JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE s.id = ? AND s.hidden = 0 AND s.version = ?',
            [lease.sessionId, lease.version],
          );
          diagnostic.finish();
          if (!rows.length) throw new Error('Conversation is unavailable.');
        }
        for (const id of ids) {
          diagnostic.start('artifact_root_row');
          const row = await tx.execute(
            'SELECT a.id, a.session_id, a.created_at, a.result_json FROM conversation_artifacts a JOIN conversation_artifact_sessions s ON s.id = a.session_id AND s.hidden = 0 JOIN conversation_artifact_generation g ON g.singleton = 1 AND s.generation = g.generation WHERE a.id = ? AND NOT EXISTS (SELECT 1 FROM conversation_deleted_artifacts d WHERE d.id = a.id)',
            [id],
          );
          diagnostic.finish();
          // Decode and witness the exact same immutable string, even if an adapter reuses its result object.
          const raw = row.rows[0]?.result_json;
          const value =
            operation?.active && operation.profileHistoryValidation
              ? measureHistoryValidationCost('artifact_root_decode', () =>
                  decodeConversationArtifact(raw),
                )
              : decodeConversationArtifact(raw);
          if (
            !value ||
            value.id !== row.rows[0]?.id ||
            value.sessionId !== row.rows[0]?.session_id ||
            value.createdAt !== row.rows[0]?.created_at ||
            (lease && value.sessionId !== lease.sessionId)
          ) {
            recordRootBytes?.();
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
              operation?.active && operation.profileHistoryValidation,
              !lease && operation?.active ? canBatchOrdinary : undefined,
            );
            recordRootBytes?.(typeof raw === 'string' ? raw : undefined);
            output.push(value);
          } catch (error) {
            // Only proven invalid lineage is unavailable; operational failures remain retryable.
            if (!(error instanceof RetainedSourceInvalidError)) throw error;
            recordRootBytes?.();
            output.push(null);
          }
        }
        diagnostic.start('artifact_read_settlement');
      };
      diagnostic.start('artifact_read_admission');
      if (operation?.active) await operation.run(work, { rollbackOnFailure });
      else await database.transaction(work);
      diagnostic.finish();
      return output;
    } catch (error) {
      diagnostic.finish('failed');
      throw error;
    }
  };
}
