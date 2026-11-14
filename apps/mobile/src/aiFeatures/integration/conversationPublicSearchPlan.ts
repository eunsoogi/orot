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
  const tool = input.external.publicWebTool;
  const deferred = Boolean(
    input.question && input.continuation && tool?.prepareAuthorizedSearch,
  );
  const eager: DefaultPublicSearchResult =
    !deferred && input.question
      ? await conversationPublicSearch(input)
      : { status: 'unavailable' };
  let status = eager.status;
  return {
    continuation: input.continuation,
    operationRunId: input.runId,
    includeExternalTools: deferred || eager.status === 'success',
    eager,
    chargeEagerSearch: Boolean(!deferred && input.question && tool),
    initialSearch: deferred
      ? { toolId: tool!.id, input: defaultPublicSearchInput(input.question) }
      : undefined,
    get currentSearch() {
      return { status };
    },
    // This display-only status never authorizes a query or substitutes for its retained evidence.
    onInitialSearchStatus(
      value: MultiAgentCheckpointState['initialSearchStatus'],
    ) {
      if (deferred && value && value !== 'pending') status = value;
    },
  };
}
