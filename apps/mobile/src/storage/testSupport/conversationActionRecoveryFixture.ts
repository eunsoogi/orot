import { conversationWorkflowContinuationFixture } from './conversationWorkflowContinuationFixture';
import { continuationManifest } from '../conversationWorkflowContinuationIdentity';
import { coldCheckpointBinding } from '../conversationColdResumeBinding';
import {
  stageConversationActionRecovery,
  type ConversationActionRecoveryStage,
} from '../conversationActionRecoveryStorage';

const signal = new AbortController().signal;
export async function conversationActionRecoveryFixture(
  owner = { attempt: 0, claimed: 0 as 0 | 1 },
) {
  const f = await conversationWorkflowContinuationFixture();
  const db = f.connection.database;
  const manifest = continuationManifest(
    { requestId: 'request', sessionId: 'session', sessionVersion: 0 },
    f.persisted.threadId,
    f.options,
  );
  const preparedInput = JSON.stringify({
    binding: {
      phase: 'local_action',
      selectedToolId: 'save-past-health-history',
      toolCalls: 1,
      execution: f.options.execution,
      evidenceReferences: [],
    },
    researchInput: { userMessage: f.options.request },
  });
  await db.execute(
    "INSERT INTO conversation_operation_journal (request_id, run_id, operation_id, input, refs, status, revision) VALUES ('request', 'run', 'tool-1:context', ?, '[]', 'ready', 0)",
    [preparedInput],
  );
  await db.execute(
    'UPDATE conversation_workflow_resumes SET attempt = ?, claimed = ?',
    [owner.attempt, owner.claimed],
  );
  const binding = await coldCheckpointBinding(db, manifest);
  const stage: ConversationActionRecoveryStage = {
    version: 1,
    submittedInput: null,
    manifest,
    ownerProcessId: '11111111-1111-4111-8111-111111111111',
    attempt: owner.attempt,
    claimed: owner.claimed,
    epoch: 0,
    operationKey: 'tool-1',
    sourceRequestId: 'request',
    checkpointId: binding!.checkpointId as string,
    checkpointBinding: binding!.bytes,
    preparedInput,
    preparedReferences: '[]',
    preparedRevision: 0,
    reconstruction: { synthetic: true },
  };
  const input = {
    requestId: 'request',
    sessionId: 'session',
    sessionVersion: 0,
    question: f.options.request,
    approvedSource: { requestId: 'request', text: f.options.request },
    operation: { operationRunId: 'run', operationKey: 'tool-1' },
  };
  await stageConversationActionRecovery(db, stage, signal);
  return { ...f, db, stage, input };
}
