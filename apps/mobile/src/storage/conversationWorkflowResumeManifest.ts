/** Protected request identity; compound policies retain their full canonical JSON. */
export interface ConversationResumeManifest {
  requestId: string;
  sessionId: string;
  sessionVersion: number;
  operationRunId: string;
  threadId: string;
  providerId: string;
  modelId: string;
  recipient: string;
  inputIdentity: string;
  contextIdentity: string;
  scopeIdentity: string;
  approvalIdentity: string;
  budgetIdentity: string;
  workflowVersion: string;
}
