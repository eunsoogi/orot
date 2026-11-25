import type { SqlDatabase } from '@orot/storage';
import { readConversationGeneration } from './conversationGeneration';
import {
  decodeConversationArtifact,
  type ConversationArtifact,
} from './conversationArtifactCodec';
import { appendConversationSourceRows } from './conversationArtifactSourceRows';
import { enqueueStatementMemory } from './userStatementMemoryJobs';
import { appendTreatmentTaskCard } from './conversationTaskCards';
import { assertConversationArtifactCurrent } from './conversationArtifactFreshness';
import { assertHistoricalDialogueParentsCurrent } from './conversationHistoricalDialogue';
import { assertConversationNotCancelled } from './conversationArtifactCancellation';
import { commitConversationRequest } from './conversationRequestStorage';
import { createSymptomSummaryStorage } from './symptomSummaryStorage';
import { isGeneratedSummarySource } from '../ragConversation/conversationArtifactSources';
import { withWritePeriodCalculations } from './writePeriodCalculationScope';
import { beginConversationSave } from './conversationSaveDiagnostic';
import { withWriteTypedFingerprints } from './writeTypedFingerprintScope';

/** Keep validation, dependency indexes and completion in the same transaction.
 * The diagnostic brackets only the existing work and never admits or repairs it. */
export function createConversationArtifactAppend(
  database: SqlDatabase,
  ensure: () => Promise<void>,
) {
  return async function append(
    value: ConversationArtifact,
    signal?: AbortSignal,
    expectedSessionVersion = 0,
  ) {
    const diagnostic = beginConversationSave();
    try {
      await ensure();
      const serialized = JSON.stringify(value);
      const decoded = decodeConversationArtifact(serialized);
      if (!decoded) throw new Error('The conversation output cannot be saved.');
      // Install the parent lifecycle guards without materializing unrelated summary rows.
      if (decoded.sources.some(isGeneratedSummarySource))
        await createSymptomSummaryStorage(database).prepareRetentionGuards();
      assertConversationNotCancelled(signal);
      diagnostic?.advance('admission');
      await database.transaction(async tx => {
        diagnostic?.advance('authority');
        let callbackOutcome: 'completed' | 'failed' = 'completed';
        try {
          assertConversationNotCancelled(signal);
          const deletedArtifact = await tx.execute(
            'SELECT id FROM conversation_deleted_artifacts WHERE id = ? LIMIT 1',
            [decoded.id],
          );
          if (deletedArtifact.rows.length)
            throw new Error('The conversation output was removed.');
          const sessions = await tx.execute(
            'SELECT generation, version FROM conversation_artifact_sessions WHERE id = ? AND hidden = 0',
            [decoded.sessionId],
          );
          if (
            !sessions.rows.length ||
            sessions.rows[0]?.generation !==
              (await readConversationGeneration(tx)) ||
            sessions.rows[0]?.version !== expectedSessionVersion
          )
            throw new Error('Conversation session was removed.');
          diagnostic?.advance('lineage');
          await withWritePeriodCalculations(
            tx,
            validate =>
              withWriteTypedFingerprints(tx, () =>
                assertConversationArtifactCurrent(
                  tx,
                  database,
                  decoded,
                  true,
                  validate,
                ),
              ),
            diagnostic?.beginPeriod,
          );
          diagnostic?.advance('persist');
          assertConversationNotCancelled(signal);
          const existing = await tx.execute(
            'SELECT result_json FROM conversation_artifacts WHERE id = ?',
            [decoded.id],
          );
          if (existing.rows.length) {
            if (existing.rows[0]?.result_json !== serialized)
              throw new Error('A different output already owns this identity.');
            if (decoded.historicalDialogueParents?.length)
              await assertHistoricalDialogueParentsCurrent(
                tx,
                decoded.sessionId,
                decoded.historicalDialogueParents,
              );
            assertConversationNotCancelled(signal);
            await commitConversationRequest(
              tx,
              decoded,
              expectedSessionVersion,
              true,
            );
            return;
          }
          await tx.execute(
            'INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
            [decoded.id, decoded.sessionId, decoded.createdAt, serialized],
          );
          if (decoded.treatmentContext)
            await appendTreatmentTaskCard(tx, decoded);
          await appendConversationSourceRows(tx, decoded);
          // An earlier invalidation rolls back this write; a later one cascades the indexed edge.
          if (decoded.historicalDialogueParents?.length)
            await assertHistoricalDialogueParentsCurrent(
              tx,
              decoded.sessionId,
              decoded.historicalDialogueParents,
            );
          // After this check, commit wins; the caller must report the saved result even if cancellation arrives later.
          assertConversationNotCancelled(signal);
          await commitConversationRequest(tx, decoded, expectedSessionVersion);
          await enqueueStatementMemory(tx, decoded);
        } catch (error) {
          callbackOutcome = 'failed';
          throw error;
        } finally {
          // Callback end is not commit. The outer await below includes driver settlement.
          diagnostic?.advance('settlement', callbackOutcome);
        }
      });
      diagnostic?.finish('completed');
    } catch (error) {
      diagnostic?.finish('failed');
      throw error;
    }
  };
}
