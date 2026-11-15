import type { SqlDatabase } from '@orot/storage';
import { stableJson } from '../aiFeatures/integration/evidenceUtils';
import type { ConversationContinuationIdentity } from './conversationWorkflowContinuationIdentity';
import { setupConversationActionRecoveryClaims } from './conversationActionRecoveryClaimSchema';
import {
  readCommittedActionRecovery,
  type CommittedActionRecoveryDescriptor,
} from './validateCommittedActionRecovery';
import {
  isDifferentConversationProcess,
  type ConversationProcessIdentity,
} from '../ragConversation/conversationProcessIdentity';

/** Only a different verified native process can replace this deceased process's
 * claim. This is not a lease timeout, UI interruption, or generic pending takeover.
 */
export function createConversationActionRecoveryClaim(database: SqlDatabase) {
  return {
    async open(
      identity: ConversationContinuationIdentity,
      process: ConversationProcessIdentity,
      signal: AbortSignal,
    ) {
      let result: CommittedActionRecoveryDescriptor | undefined;
      await database.transaction(async sql => {
        const tables = await sql.execute(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'conversation_action_recovery'",
        );
        if (!tables.rows.length || signal.aborted) return;
        await setupConversationActionRecoveryClaims(sql);
        try {
          const d = await readCommittedActionRecovery(
            sql,
            identity.requestId,
            process,
          );
          if (
            d?.stage.manifest.sessionId === identity.sessionId &&
            d.stage.manifest.sessionVersion === identity.sessionVersion &&
            !signal.aborted
          )
            result = d;
        } catch {
          /* Invalid protected metadata is unavailable, never permission to retry. */
        }
      });
      return signal.aborted ? undefined : result;
    },
    async claim(
      supplied: CommittedActionRecoveryDescriptor,
      process: ConversationProcessIdentity,
      signal: AbortSignal,
      validate: (
        d: CommittedActionRecoveryDescriptor,
        signal: AbortSignal,
      ) => Promise<boolean>,
    ) {
      const encoded = stableJson(supplied);
      const d: CommittedActionRecoveryDescriptor = JSON.parse(encoded);
      const opened = await this.open(d.stage.manifest, process, signal);
      if (
        !opened ||
        stableJson(opened) !== encoded ||
        signal.aborted ||
        !(await validate(opened, signal)) ||
        signal.aborted ||
        stableJson(opened) !== encoded
      )
        throw new Error('Committed action recovery reconstruction changed.');
      const attempt = d.stage.attempt + 1;
      if (!Number.isSafeInteger(attempt))
        throw new Error('Action recovery attempt exhausted.');
      await database.transaction(async sql => {
        const current = await readCommittedActionRecovery(
          sql,
          d.stage.manifest.requestId,
          process,
        );
        if (
          !current ||
          stableJson(current) !== encoded ||
          signal.aborted ||
          !isDifferentConversationProcess(d.stage.ownerProcessId, process)
        )
          throw new Error(
            'Committed action recovery already claimed or invalidated.',
          );
        await sql.execute(
          'UPDATE conversation_workflow_resumes SET attempt = ?, claimed = 1 WHERE request_id = ? AND attempt = ? AND claimed = ?',
          [
            attempt,
            d.stage.manifest.requestId,
            d.stage.attempt,
            d.stage.claimed,
          ],
        );
        const owner = (
          await sql.execute(
            'SELECT attempt, claimed FROM conversation_workflow_resumes WHERE request_id = ?',
            [d.stage.manifest.requestId],
          )
        ).rows[0];
        if (owner?.attempt !== attempt || owner.claimed !== 1)
          throw new Error('Action recovery owner changed.');
        await sql.execute(
          'INSERT INTO conversation_action_recovery_claims VALUES (?, ?, ?, ?)',
          [d.stage.manifest.requestId, encoded, process.value, attempt],
        );
        await sql.execute(
          "UPDATE conversation_requests SET status = 'active', interruption_reason = NULL WHERE id = ?",
          [d.stage.manifest.requestId],
        );
        if (signal.aborted) throw new Error('Action recovery claim cancelled.');
      });
      return {
        requestId: d.stage.manifest.requestId,
        checkpointId: d.stage.checkpointId,
        attempt,
      };
    },
  };
}
