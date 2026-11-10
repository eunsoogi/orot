import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import { finishRagConversation } from './finishRagConversation';
import type {
  RagConversationOutcome,
  RagConversationObserver,
} from '../../ragConversation/service';
import type { RagConversationMessage } from '../../ragConversation/task';
import { executionOptions, toolsFor } from './featureServiceExecution';
import { createLinkedAbortController } from './linkedAbortController';
import { operationRunId } from './featureRunIdentity';
import { conversationGeneratedTools } from './conversationGeneratedTools';
import { withProviderStage } from '../../providers/diagnostics';
import { ragConversationFailure } from './ragConversationFailure';
import { observeLocalSearchFailures } from './observeLocalSearchFailures';
import { createConversationRetentionBridge } from './conversationRetentionBridge';
import { createResearchInputTracker } from './researchInputTracker';
import { budgetAfterPublicSearch } from './defaultPublicSearch';
import type { ConversationEntryContext } from './conversationIntent';
import { conversationEarlyResponse } from './conversationEarlyResponse';
import { loadConversationHistory } from './conversationHistorySources';
import { conversationFallbackOutcome } from './conversationFallbackOutcome';
import { guardHistory } from './conversationHistoryProviderGuard';
import {
  conversationInputsAreCurrent,
  emptyConversationSnapshot,
  resolveConversationTargets,
} from './conversationEntryTargets';
import {
  conversationExternalEvidence,
  conversationPublicSearch,
} from './conversationExternalEvidence';

/** Keeps local availability checks ahead of provider resolution and model dispatch. */
export function createRagConversationService({
  consent,
  queryConsent,
  externalEvidence,
  loadLocalData,
  selectedAi,
  registry,
  ragRunner,
  createOperationRunId,
  resolveDailyReport,
}: RagConversationServiceDependencies) {
  return async function sendRagMessage(
    question: string,
    previousMessages: readonly RagConversationMessage[],
    parentSignal?: AbortSignal,
    observer?: RagConversationObserver,
    entryContext?: ConversationEntryContext,
  ): Promise<RagConversationOutcome> {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || normalizedQuestion.length > 1000) {
      return { status: 'failure', kind: 'validation_failed' };
    }
    const linked = createLinkedAbortController(parentSignal);
    const signal = linked.controller.signal;
    let stage: 'selection' | 'data' | 'workflow' = 'selection';
    try {
      stage = 'data';
      const target = await resolveConversationTargets({
        context: entryContext,
        loadLocalData,
        resolveDailyReport,
        registry,
        signal,
      });
      if (target.failure)
        return {
          status: 'failure',
          kind: signal.aborted ? 'cancelled' : target.failure,
        };
      const report = target.report;
      stage = 'selection';
      const early =
        !report &&
        (await conversationEarlyResponse({
          question: normalizedQuestion,
          observer,
          loadLocalData,
          targetData: target.data,
          registry,
          signal,
          onData: () => {
            stage = 'data';
          },
        }));
      if (early) return early;
      stage = 'selection';
      const selected = await withProviderStage('rag', 'selection', selectedAi);
      stage = 'data';
      const data =
        target.data ?? (await withProviderStage('rag', 'data', loadLocalData));
      // User follow-ups may influence an answer, so retain their validated turn lineage.
      const history = await loadConversationHistory({
        messages: previousMessages,
        session: observer?.retentionSession,
        retainedHistory: observer?.retainedHistory,
        data,
        registry,
        signal,
      });
      const historyIsCurrent = conversationInputsAreCurrent(
        registry,
        history.references,
        signal,
        report,
      );
      const researchInputs = createResearchInputTracker(
        registry,
        data,
        observer?.retentionSession?.id,
      );
      const external = conversationExternalEvidence({
        selected,
        consent,
        queryConsent,
        externalEvidence,
        loadLocalData,
        observer,
        researchInputs,
      });
      const runId = createOperationRunId?.() ?? operationRunId();
      const publicSearch = await conversationPublicSearch({
        external,
        observer,
        runId,
        question: normalizedQuestion,
        signal,
      });
      if (publicSearch.status === 'cancelled')
        return { status: 'failure', kind: 'cancelled' };
      let localRetrievalFailed = false;
      const generated = conversationGeneratedTools(data, registry, observer);
      const tools = [
        ...observeLocalSearchFailures(
          researchInputs.wrap([
            ...toolsFor(undefined, data, registry, 6, true, 'rag'),
            ...generated.tools,
          ]),
          () => {
            localRetrievalFailed = true;
          },
        ),
        ...(publicSearch.status === 'success' || !external.publicWebTool
          ? external.tools
          : []),
      ];
      const retention = createConversationRetentionBridge({
        observer,
        registry,
        question: normalizedQuestion,
        providerId: selected.provider.id,
        modelId: selected.modelId,
        entryContext,
        priorDialogue: history.priorTurns,
        priorUserReports: history.reports,
        ...(history.omitted ? { priorDialogueOmitted: true as const } : {}),
        signal,
      });
      const execution = executionOptions({
        consentPurpose: 'record_conversation',
        selected,
        operationRunId: runId,
        consent,
        registry,
        tools,
        external,
      });
      stage = 'workflow';
      if (!(await historyIsCurrent()))
        return { status: 'failure', kind: 'retrieval_failed' };
      const outcome = await ragRunner(
        {
          question: normalizedQuestion,
          entryIntent: entryContext?.intent,
          targetVisitEvidence: target.evidence,
          dailyReportEvidence: report?.items,
          previousMessages: history.messages,
          validatedPriorTurns: history.priorTurns,
          priorDialogueOmitted: history.omitted,
          onValidatedEvidence: references =>
            retention.onValidatedEvidence([
              ...references,
              ...history.sources,
              ...(report?.items ?? []),
            ]),
          loadCurrentEvidence: emptyConversationSnapshot,
          rag: data.rag,
          ...(publicSearch.status === 'success'
            ? { publicEvidence: publicSearch.batch }
            : {}),
          resolveLocalEvidenceIdentity: reference =>
            registry.resolve(reference),
          readHistoricalArtifact: (reference, readSignal) =>
            registry.readSource(reference, readSignal),
          workflow: {
            ...guardHistory(
              execution,
              historyIsCurrent,
              !!history.references.length || !!report,
            ),
            execution: {
              ...execution.execution,
              budget: budgetAfterPublicSearch(
                execution.execution.budget,
                publicSearch,
                Boolean(external.publicWebTool),
              ),
            },
          },
        },
        {
          onProgress: observer?.onProgress,
          onToolEvent: observer?.onToolEvent,
          // A changed history must not leak a draft before its lineage is rechecked.
          onTaskStreamEvent:
            history.references.length || report
              ? undefined
              : observer?.onTaskStreamEvent,
          signal,
        },
      );
      if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
      if (!(await historyIsCurrent()))
        return { status: 'failure', kind: 'retrieval_failed' };
      const continuation = generated.choose(outcome);
      observer?.onArtifactContinuation?.(continuation);
      const fallback = conversationFallbackOutcome(
        outcome,
        Boolean(continuation),
        localRetrievalFailed,
      );
      if (fallback) return fallback;
      return await finishRagConversation({
        outcome,
        publicSearch,
        retention,
        signal,
        continuation: Boolean(continuation),
        reportIsCurrent: report?.isCurrent,
      });
    } catch (error) {
      return ragConversationFailure(error, signal, stage);
    } finally {
      linked.dispose();
    }
  };
}
