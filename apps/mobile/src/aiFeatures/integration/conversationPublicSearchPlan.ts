import { explicitConversationLiteratureRoute } from './explicitConversationLiteratureRoute';
import type { ConversationIntent } from './conversationIntent';
import type { MultiAgentCheckpointState } from '@orot/agent-runtime';
import type { ConversationWorkflowContinuation } from '../../ragConversation/conversationWorkflowContinuation';
import { conversationPublicSearch } from './conversationExternalEvidence';
import { defaultPublicSearchInput, type DefaultPublicSearchResult } from './defaultPublicSearch';

/** Retained turns perform their first external lookup inside the durable graph, not before it. */
export async function conversationPublicSearchPlan(
  input: Parameters<typeof conversationPublicSearch>[0] & {
    continuation?: ConversationWorkflowContinuation;
    entryIntent?: ConversationIntent;
  },
) {
  const literatureOnly = explicitConversationLiteratureRoute(input.question, input.entryIntent);
  const tool = literatureOnly ? undefined : input.external.publicWebTool;
  const deferred = Boolean(input.question && input.continuation && tool?.prepareAuthorizedSearch);
  const eager: DefaultPublicSearchResult =
    !literatureOnly && !deferred && input.question
      ? await conversationPublicSearch(input)
      : { status: 'unavailable' };
  let status = eager.status;
  return {
    continuation: input.continuation,
    operationRunId: input.runId,
    includeExternalTools: deferred || eager.status === 'success',
    literatureOnly,
    toolPolicy: {
      publicSearchSucceeded: deferred || eager.status === 'success',
      literatureOnly,
      ...(!literatureOnly && (!input.entryIntent || input.entryIntent === 'conversation')
        ? { typedHeartRateOwner: { operationRunId: input.runId, signal: input.signal } }
        : {}),
    },
    eager,
    // Completed preflight status/budget only; no reusable authorization is persisted.
    coldSearch:
      !deferred && eager.status !== 'cancelled'
        ? {
            version: 1 as const,
            status: eager.status,
            charged: Boolean(input.question && tool),
            ...(literatureOnly ? { literatureOnly: true as const } : {}),
          }
        : undefined,
    chargeEagerSearch: Boolean(!deferred && input.question && tool),
    initialSearch: deferred
      ? { toolId: tool!.id, input: defaultPublicSearchInput(input.question) }
      : undefined,
    get currentSearch() {
      return { status };
    },
    // This display-only status never authorizes a query or substitutes for its retained evidence.
    onInitialSearchStatus(value: MultiAgentCheckpointState['initialSearchStatus']) {
      if (deferred && value && value !== 'pending') status = value;
    },
  };
}
