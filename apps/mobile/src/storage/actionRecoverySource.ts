import type { SqlExecutor } from '@orot/storage';
import type { ConversationActionRecoveryStage } from './conversationActionRecoveryStorage';
import { conversationHistoryIntent } from '../manualHistory/conversationHistoryIntent';

/** Resolve the exact retained user message, not a model-selected arbitrary row.
 * Ambiguous duplicate prior wording is refused just like the live action adapter.
 */
export async function recoverySource(
  sql: SqlExecutor,
  requestId: string,
  sessionId: string,
  question: string,
  selected: string,
) {
  if (selected === question) return requestId;
  const rows = (
    await sql.execute(
      'SELECT id, result_json FROM conversation_artifacts WHERE session_id=?',
      [sessionId],
    )
  ).rows;
  const matches = rows.filter(row => {
    try {
      return JSON.parse(String(row.result_json)).question === selected;
    } catch {
      return false;
    }
  });
  return matches.length === 1 ? String(matches[0].id) : undefined;
}

/** Reconstruct only the source identity encoded in the protected prepared input. */
export async function actionRecoverySourceMatches(
  sql: SqlExecutor,
  d: ConversationActionRecoveryStage,
  question: string,
) {
  const selected = JSON.parse(d.preparedInput).researchInput?.userMessage;
  return (
    typeof selected === 'string' &&
    (await recoverySource(
      sql,
      d.manifest.requestId,
      d.manifest.sessionId,
      question,
      selected,
    )) === d.sourceRequestId
  );
}

export function recoverySaveInput(
  d: ConversationActionRecoveryStage,
  question: string,
) {
  const selected = JSON.parse(d.preparedInput).researchInput
    .userMessage as string;
  return {
    requestId: d.manifest.requestId,
    sessionId: d.manifest.sessionId,
    sessionVersion: d.manifest.sessionVersion,
    question,
    approvedSource: {
      requestId: d.sourceRequestId,
      text: conversationHistoryIntent(selected) ?? selected,
    },
    operation: {
      operationRunId: d.manifest.operationRunId,
      operationKey: d.operationKey,
    },
  };
}
