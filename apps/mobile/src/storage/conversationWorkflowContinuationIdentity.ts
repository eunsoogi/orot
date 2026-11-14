import type { MultiAgentWorkflowOptions } from '@orot/agent-runtime';
import {
  fingerprint,
  stableJson,
} from '../aiFeatures/integration/evidenceUtils';
import type { ConversationResumeManifest } from './conversationWorkflowResumeStorage';

export interface ConversationContinuationIdentity {
  requestId: string;
  sessionId: string;
  sessionVersion: number;
}
/** Same-process exact comparison complements compact persisted change markers. No secret or prompt is logged. */
export function continuationInput(options: MultiAgentWorkflowOptions<unknown>) {
  return stableJson({
    request: options.request,
    context: options.context ?? null,
    initialEvidence: options.initialEvidence ?? null,
    photo: options.photoInput ?? null,
    execution: options.execution,
    initialSearch: options.initialSearch ?? null,
    task: options.task,
    tools: options.tools.map(tool => ({
      id: tool.id,
      execution: tool.execution,
      sourceKind: tool.sourceKind,
      inputSchema: tool.inputSchema,
      description: tool.description,
      additionalModelCalls: tool.additionalModelCalls ?? 0,
    })),
  });
}
export function continuationManifest(
  identity: ConversationContinuationIdentity,
  threadId: string,
  options: MultiAgentWorkflowOptions<unknown>,
): ConversationResumeManifest {
  const e = options.execution;
  return {
    ...identity,
    threadId,
    operationRunId: e.operationRunId,
    providerId: e.providerId,
    modelId: e.modelId,
    recipient: e.recipient,
    inputIdentity: fingerprint(options.request),
    contextIdentity: fingerprint(continuationInput(options)),
    scopeIdentity: stableJson(e.allowedScope),
    budgetIdentity: stableJson(e.budget),
    approvalIdentity: stableJson({
      scope: e.consentScope ?? null,
      remote: e.remoteProcessing,
    }),
    workflowVersion: 'conversation-safe-boundary-v1',
  };
}
