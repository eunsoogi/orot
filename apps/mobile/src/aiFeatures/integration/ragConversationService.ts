import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import { finishRagConversation } from './finishRagConversation';
import type { RagConversationOutcome } from '../../ragConversation/service';
import type { RagConversationObserver } from '../../ragConversation/service';
import type { RagConversationMessage } from '../../ragConversation/task';
import { executionOptions, toolsFor } from './featureServiceExecution';
import { createLinkedAbortController } from './linkedAbortController';
import { createSelectedExternalEvidence } from './selectedExternalEvidence';
import { operationRunId } from './featureRunIdentity';
import { conversationGeneratedTools } from './conversationGeneratedTools';
import { withProviderStage } from '../../providers/diagnostics';
import { ragConversationFailure } from './ragConversationFailure';
import { observeLocalSearchFailures } from './observeLocalSearchFailures';
import { createConversationRetentionBridge } from './conversationRetentionBridge';
import { createResearchInputTracker } from './researchInputTracker';
import { observeConversationTool } from '../../ragConversation/observeConversationTool';
import { retainLiteratureResults } from './researchRetention';
import {
  budgetAfterPublicSearch,
  runDefaultPublicSearch,
} from './defaultPublicSearch';
import type { ConversationEntryContext } from './conversationIntent';
import { resolveConversationEntryTarget } from './conversationVisitTarget';
import { conversationEarlyResponse } from './conversationEarlyResponse';
import {
  conversationHistoryIsCurrent,
  conversationHistorySources,
  prepareConversationHistory,
} from './conversationHistorySources';
import { conversationFallbackOutcome } from './conversationFallbackOutcome';

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
      // Resolve the Home target before any provider work; never fall back to another visit.
      if (entryContext?.appointmentId !== undefined) stage = 'data';
      const target = await resolveConversationEntryTarget({
        context: entryContext,
        loadLocalData,
        registry,
        signal,
      });
      if (target.failure)
        return {
          status: 'failure',
          kind: signal.aborted ? 'cancelled' : target.failure,
        };
      stage = 'selection';
      const early = await conversationEarlyResponse({
        question: normalizedQuestion,
        observer,
        loadLocalData,
        targetData: target.data,
        registry,
        signal,
        onData: () => {
          stage = 'data';
        },
      });
      if (early) return early;
      stage = 'selection';
      const selected = await withProviderStage('rag', 'selection', selectedAi);
      stage = 'data';
      const data =
        target.data ?? (await withProviderStage('rag', 'data', loadLocalData));
      // User follow-ups may influence an answer, so retain their validated turn lineage.
      const history = await conversationHistorySources({
        history: previousMessages,
        session: observer?.retentionSession,
        data,
        registry,
        signal,
      });
      const historySources = history.references;
      const boundedHistory = prepareConversationHistory(
        previousMessages,
        registry,
      );
      const researchInputs = createResearchInputTracker(
        registry,
        data,
        observer?.retentionSession?.id,
      );
      const external = createSelectedExternalEvidence({
        selected,
        consent,
        literature: retainLiteratureResults(
          externalEvidence,
          loadLocalData,
          'record_conversation',
          observer?.retentionSession,
          researchInputs.recordResearch,
          { providerId: selected.provider.id, modelId: selected.modelId },
        ),
        literatureConsent: queryConsent,
        loadData: loadLocalData,
        originFeature: 'record_conversation',
        retentionSession: observer?.retentionSession,
        captureResearchInputs: researchInputs.capture,
        validateResearchInputs: researchInputs.revalidate,
        onResearchRetained: researchInputs.recordResearch,
      });
      const runId = createOperationRunId?.() ?? operationRunId();
      const publicSearch = await runDefaultPublicSearch({
        tool: observeConversationTool(
          external.publicWebTool,
          observer?.onToolEvent,
        ),
        operationRunId: runId,
        request: normalizedQuestion,
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
        ...(entryContext?.intent === 'possibilities'
          ? { entryIntent: 'possibilities' as const }
          : {}),
        priorDialogue: history.priorTurns,
        priorUserReports: boundedHistory.reports,
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
      if (
        !(await conversationHistoryIsCurrent(registry, historySources, signal))
      )
        return { status: 'failure', kind: 'retrieval_failed' };
      const outcome = await ragRunner(
        {
          question: normalizedQuestion,
          entryIntent: entryContext?.intent,
          targetVisitEvidence: target.evidence,
          previousMessages: boundedHistory.messages,
          validatedPriorTurns: history.priorTurns,
          onValidatedEvidence: references =>
            retention.onValidatedEvidence([...references, ...history.sources]),
          loadCurrentEvidence: async () => ({
            batch: { items: [], coverage: [], conflicts: [] },
            chunks: [],
          }),
          rag: data.rag,
          ...(publicSearch.status === 'success'
            ? { publicEvidence: publicSearch.batch }
            : {}),
          resolveLocalEvidenceIdentity: reference =>
            registry.resolve(reference),
          readHistoricalArtifact: (reference, readSignal) =>
            registry.readSource(reference, readSignal),
          workflow: {
            ...execution,
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
          onTaskStreamEvent: historySources.length
            ? undefined
            : observer?.onTaskStreamEvent,
          signal,
        },
      );
      if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
      if (
        !(await conversationHistoryIsCurrent(registry, historySources, signal))
      )
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
      });
    } catch (error) {
      return ragConversationFailure(error, signal, stage);
    } finally {
      linked.dispose();
    }
  };
}
