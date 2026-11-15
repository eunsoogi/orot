import type { SqlDatabase } from '@orot/storage';
import type {
  ConversationColdReconstruction,
  ConversationContinuationCapture,
} from './conversationContinuationCapture';
import {
  continuationInput,
  continuationManifest,
  type ConversationContinuationIdentity,
} from './conversationWorkflowContinuationIdentity';
import { readConversationProcessIdentity } from '../ragConversation/conversationProcessIdentity';
import { coldCheckpointBinding } from './conversationColdResumeBinding';
import { readConversationColdCallIds } from './optionalConversationColdCapture';
import { stageConversationActionRecovery } from './conversationActionRecoveryStorage';
import { setupConversationActionRecovery } from './conversationActionRecoverySchema';

/** Optional pre-dispatch snapshot. Unsupported input remains a normal action,
 * never an advertised recovery. Stage failure cannot leave an older stage reusable.
 */
export function optionalConversationActionCapture(
  database: SqlDatabase,
  identity: ConversationContinuationIdentity,
  reconstruct: ConversationColdReconstruction,
): ConversationContinuationCapture {
  return async input => {
    if (
      input.checkpoint.selectedToolId !== 'save-past-health-history' ||
      input.checkpoint.committedAction ||
      !input.evidenceBatches
    )
      return;
    const signal = input.signal;
    if (!signal || signal.aborted) return;
    const process = await readConversationProcessIdentity(signal);
    if (!process) return;
    await setupConversationActionRecovery(database);
    const clear = () =>
      database.execute(
        'DELETE FROM conversation_action_recovery WHERE request_id = ?',
        [identity.requestId],
      );
    await clear();
    try {
      const manifest = continuationManifest(
        identity,
        `conversation-resume:${identity.requestId}`,
        input.options,
      );
      const operationKey = input.checkpoint.pendingOperation?.operationKey;
      if (!operationKey) return;
      const row = (
        await database.execute(
          `SELECT j.input, j.refs, j.revision, w.claimed, e.value AS epoch
        FROM conversation_operation_journal j JOIN conversation_workflow_resumes w ON w.request_id=j.request_id
        JOIN conversation_journal_epoch e ON e.id=1
        WHERE j.request_id=? AND j.run_id=? AND j.operation_id=? AND j.status='ready'`,
          [
            identity.requestId,
            manifest.operationRunId,
            `${operationKey}:context`,
          ],
        )
      ).rows[0];
      if (
        !row ||
        typeof row.input !== 'string' ||
        typeof row.refs !== 'string' ||
        JSON.parse(row.input).researchInput?.userMessage !==
          input.options.request
      )
        return;
      const binding = await coldCheckpointBinding(database, manifest);
      if (!binding || binding.checkpointId !== input.checkpointId) return;
      const knownCallIds = await readConversationColdCallIds(
        database,
        identity,
        manifest.operationRunId,
      );
      const reconstruction = await reconstruct({ ...input, knownCallIds });
      const descriptor = {
        version: 1,
        manifest,
        checkpointId: input.checkpointId,
        attempt: input.attempt,
        sourceEpoch: Number(row.epoch),
        request: input.options.request,
        exactInput: continuationInput(input.options),
        submittedInput: input.submittedInput ?? null,
        reconstruction,
      };
      await stageConversationActionRecovery(
        database,
        {
          version: 1,
          manifest,
          ownerProcessId: process.value,
          submittedInput:
            typeof input.submittedInput === 'string'
              ? input.submittedInput
              : null,
          attempt: input.attempt,
          claimed: row.claimed as 0 | 1,
          epoch: Number(row.epoch),
          operationKey,
          sourceRequestId: identity.requestId,
          checkpointId: input.checkpointId,
          checkpointBinding: binding.bytes,
          preparedInput: row.input,
          preparedReferences: row.refs,
          preparedRevision: Number(row.revision),
          reconstruction: JSON.parse(JSON.stringify(descriptor)),
        },
        signal,
      );
    } catch {
      await clear();
    }
  };
}
