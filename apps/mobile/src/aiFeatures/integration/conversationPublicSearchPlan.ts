import { explicitConversationLiteratureRoute } from './explicitConversationLiteratureRoute';
import type { ConversationIntent } from './conversationIntent';
import type { MultiAgentCheckpointState } from '@orot/agent-runtime';
import type { ConversationWorkflowContinuation } from '../../ragConversation/conversationWorkflowContinuation';
import type { conversationExternalEvidence } from '../../conversationTools/conversationExternalEvidence';
import type { DefaultPublicSearchResult } from './defaultPublicSearch';
import { initialConversationLookup } from '../../conversationTools/conversationToolContribution';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import { observeConversationTool } from '../../ragConversation/observeConversationTool';

/** Retained turns perform their first external lookup inside the durable graph, not before it. */
export async function conversationPublicSearchPlan(input: {
  external: ReturnType<typeof conversationExternalEvidence>;
  observer?: RagConversationObserver;
  runId: string;
  question: string;
  signal: AbortSignal;
  continuation?: ConversationWorkflowContinuation;
  entryIntent?: ConversationIntent;
}) {
  const literatureOnly = explicitConversationLiteratureRoute(
    input.question,
    input.entryIntent,
  );
  const lookup = literatureOnly
    ? undefined
    : initialConversationLookup(input.external.tools);
  const tool = lookup?.tool;
  const deferred = Boolean(
    input.question && input.continuation && tool?.prepareAuthorizedSearch,
  );
  const eager: DefaultPublicSearchResult =
    literatureOnly || deferred || !input.question
      ? { status: 'unavailable' }
      : input.signal.aborted
        ? { status: 'cancelled' }
        : lookup
          ? await lookup.run({
              tool: observeConversationTool(
                lookup.tool,
                input.observer?.onToolEvent,
              )!,
              operationRunId: input.runId,
              request: input.question,
              signal: input.signal,
            })
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
      ...(!literatureOnly &&
      (!input.entryIntent || input.entryIntent === 'conversation')
        ? {
            preparationOwner: {
              operationRunId: input.runId,
              signal: input.signal,
            },
          }
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
    initialSearch:
      deferred && lookup
        ? { toolId: lookup.tool.id, input: lookup.input(input.question) }
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
