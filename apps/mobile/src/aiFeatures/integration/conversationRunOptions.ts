import type { LanguageModelProvider } from '@orot/model-runtime';
import type { MultiAgentBudget } from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { DefaultPublicSearchResult } from './defaultPublicSearch';
import { budgetAfterPublicSearch } from './defaultPublicSearch';
import { guardHistory } from './conversationHistoryProviderGuard';
import { conversationStreamObservers } from './conversationStreamObservers';
import type { RagConversationRunOptions } from '../../ragConversation/service';
import type { loadConversationHistory } from './conversationHistorySources';
import type { createConversationRetentionBridge } from './conversationRetentionBridge';
import { emptyConversationSnapshot } from './conversationEntryTargets';

/** Preserve source fences and the actual preflight budget for this invocation. */
export function conversationRunWorkflow<
  T extends {
    provider: LanguageModelProvider;
    execution: { budget: MultiAgentBudget };
  },
>(
  execution: T,
  current: () => Promise<boolean>,
  hasHistory: boolean,
  search: DefaultPublicSearchResult,
  searchedTool: boolean,
) {
  return {
    ...guardHistory(execution, current, hasHistory),
    execution: {
      ...execution.execution,
      budget: budgetAfterPublicSearch(
        execution.execution.budget,
        search,
        searchedTool,
      ),
    },
  };
}

/** Preview suppression does not suppress the caller's source-fence callbacks. */
export function conversationRunInvocation(
  observer: RagConversationObserver | undefined,
  retained: boolean,
  registry: LocalEvidenceReferenceRegistry,
  selection: { providerId: string; modelId: string },
  signal: AbortSignal,
) {
  return {
    onProgress: observer?.onProgress,
    onToolEvent: observer?.onToolEvent,
    ...conversationStreamObservers(observer, retained, registry, selection),
    signal,
  };
}

/** Keep history and selected evidence lineage attached to the responder input. */
export function conversationRunRequest(input: {
  readonly question: string;
  readonly photoEvidence?: RagConversationRunOptions['photoEvidence'];
  readonly entryIntent?: RagConversationRunOptions['entryIntent'];
  readonly targetVisitEvidence?: RagConversationRunOptions['targetVisitEvidence'];
  readonly dailyReportEvidence?: RagConversationRunOptions['dailyReportEvidence'];
  readonly history: Awaited<ReturnType<typeof loadConversationHistory>>;
  readonly retention: ReturnType<typeof createConversationRetentionBridge>;
  readonly rag: RagConversationRunOptions['rag'];
  readonly search: DefaultPublicSearchResult;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly workflow: RagConversationRunOptions['workflow'];
}): RagConversationRunOptions {
  return {
    question: input.question,
    ...(input.photoEvidence ? { photoEvidence: input.photoEvidence } : {}),
    entryIntent: input.entryIntent,
    targetVisitEvidence: input.targetVisitEvidence,
    dailyReportEvidence: input.dailyReportEvidence,
    previousMessages: input.history.messages,
    validatedPriorTurns: input.history.priorTurns,
    priorDialogueOmitted: input.history.omitted,
    onValidatedEvidence: references =>
      input.retention.onValidatedEvidence([
        ...references,
        ...input.history.sources,
        ...(input.dailyReportEvidence ?? []),
      ]),
    loadCurrentEvidence: emptyConversationSnapshot,
    rag: input.rag,
    ...(input.search.status === 'success'
      ? { publicEvidence: input.search.batch }
      : {}),
    resolveLocalEvidenceIdentity: reference =>
      input.registry.resolve(reference),
    readHistoricalArtifact: (reference, signal) =>
      input.registry.readSource(reference, signal),
    workflow: input.workflow,
  };
}
