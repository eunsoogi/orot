import type { MultiAgentCheckpointState } from '@orot/agent-runtime';
import type { ConversationWorkflowContinuation } from '../../ragConversation/conversationWorkflowContinuation';
import { conversationPublicSearch } from './conversationExternalEvidence';
import {
  defaultPublicSearchInput,
  type DefaultPublicSearchResult,
} from './defaultPublicSearch';

/** Retained turns perform their first external lookup inside the durable graph, not before it. */
export async function conversationPublicSearchPlan(
  input: Parameters<typeof conversationPublicSearch>[0] & {
    continuation?: ConversationWorkflowContinuation;
  },
) {
  const curated = input.external.curatedSearch?.(input.question, input.signal);
  const tool = curated ? undefined : input.external.publicWebTool;
  const deferred = Boolean(
    input.question && input.continuation && tool?.prepareAuthorizedSearch,
  );
  const eager: DefaultPublicSearchResult =
    curated ??
    (!deferred && input.question
      ? await conversationPublicSearch(input)
      : { status: 'unavailable' });
  let status = eager.status;
  const publisherReason =
    curated?.status === 'unavailable' &&
    curated.reason === 'publisher_refresh_required'
      ? curated.reason
      : undefined;
  return {
    continuation: input.continuation,
    operationRunId: input.runId,
    includeExternalTools: deferred || eager.status === 'success',
    eager,
    // Completed preflight status/budget only; no reusable authorization is persisted.
    coldSearch:
      !deferred && eager.status !== 'cancelled'
        ? {
            version: 1 as const,
            status: eager.status,
            charged: Boolean(input.question && tool),
            ...(publisherReason ? { reason: publisherReason } : {}),
          }
        : undefined,
    chargeEagerSearch: Boolean(!deferred && input.question && tool),
    initialSearch: deferred
      ? { toolId: tool!.id, input: defaultPublicSearchInput(input.question) }
      : undefined,
    get currentSearch() {
      return {
        status,
        ...(publisherReason ? { reason: publisherReason } : {}),
      };
    },
    // This display-only status never authorizes a query or substitutes for its retained evidence.
    onInitialSearchStatus(
      value: MultiAgentCheckpointState['initialSearchStatus'],
    ) {
      if (deferred && value && value !== 'pending') status = value;
    },
  };
}
