import type { RagConversationServiceDependencies } from './ragConversationServiceDependencies';
import { finishRagConversation } from './finishRagConversation';
import { isRagConversationAvailabilityQuestion } from '../../ragConversation/availabilityIntent';
import type { RagConversationOutcome } from '../../ragConversation/service';
import type { RagConversationObserver } from '../../ragConversation/service';
import { requestsArtifactContinuation } from '../../ragConversation/artifactContinuation';
import { continueArtifactSearch } from './continueArtifactSearch';
import type { RagConversationMessage } from '../../ragConversation/task';
import { boundRagConversationHistory } from './evidencePayload';
import { executionOptions, toolsFor } from './featureServiceExecution';
import { createLinkedAbortController } from './linkedAbortController';
import { createSelectedExternalEvidence } from './selectedExternalEvidence';
import { operationRunId } from './featureRunIdentity';
import { conversationGeneratedTools } from './conversationGeneratedTools';
import { withProviderStage } from '../../providers/diagnostics';
import { AiProviderSelectionError } from './provider';
import { readConversationAvailability } from './readConversationAvailability';
import { observeLocalSearchFailures } from './observeLocalSearchFailures';
import { createConversationRetentionBridge } from './conversationRetentionBridge';
import { createResearchInputTracker } from './researchInputTracker';
import { observeConversationTool } from '../../ragConversation/observeConversationTool';
import { retainLiteratureResults } from './researchRetention';
import {
  budgetAfterPublicSearch,
  runDefaultPublicSearch,
} from './defaultPublicSearch';

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
  ): Promise<RagConversationOutcome> {
    const normalizedQuestion = question.trim();
    if (!normalizedQuestion || normalizedQuestion.length > 1000) {
      return { status: 'failure', kind: 'validation_failed' };
    }
    const linked = createLinkedAbortController(parentSignal);
    const signal = linked.controller.signal;
    let stage: 'selection' | 'data' | 'workflow' = 'selection';
    try {
      if (
        observer?.conversationScope &&
        observer.artifactContinuation &&
        requestsArtifactContinuation(normalizedQuestion)
      ) {
        stage = 'data';
        const data = await withProviderStage('rag', 'data', loadLocalData);
        return await continueArtifactSearch({
          data,
          registry,
          scope: observer.conversationScope,
          continuation: observer.artifactContinuation,
          signal,
          onContinuation: value => observer.onArtifactContinuation?.(value),
        });
      }
      observer?.onArtifactContinuation?.(null);
      if (isRagConversationAvailabilityQuestion(normalizedQuestion)) {
        stage = 'data';
        const data = await withProviderStage('rag', 'data', loadLocalData);
        return await readConversationAvailability(data, signal);
      }

      const selected = await withProviderStage('rag', 'selection', selectedAi);
      stage = 'data';
      const data = await withProviderStage('rag', 'data', loadLocalData);
      const researchInputs = createResearchInputTracker(registry, data);
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
      const outcome = await ragRunner(
        {
          question: normalizedQuestion,
          previousMessages: boundRagConversationHistory(previousMessages),
          onValidatedEvidence: retention.onValidatedEvidence,
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
          onTaskStreamEvent: observer?.onTaskStreamEvent,
          signal,
        },
      );
      if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
      const continuation = generated.choose(outcome);
      observer?.onArtifactContinuation?.(continuation);
      if (
        continuation &&
        (outcome.status === 'no_evidence' || outcome.status === 'insufficient')
      )
        return {
          status: 'answer',
          citations: [],
          answer:
            '아직 일치하는 결과를 찾지 못했어요. 더 이전 결과를 계속 찾아볼 수 있어요.',
        };
      if (
        localRetrievalFailed &&
        (outcome.status === 'no_evidence' ||
          outcome.status === 'insufficient' ||
          (outcome.status === 'failure' && outcome.kind === 'unavailable'))
      ) {
        return { status: 'failure', kind: 'retrieval_failed' };
      }
      return await finishRagConversation({
        outcome,
        publicSearch,
        retention,
        signal,
        continuation: Boolean(continuation),
      });
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      )
        return { status: 'failure', kind: 'cancelled' };
      if (error instanceof AiProviderSelectionError) {
        // Selection exposes no safe reason code, so keep unavailable distinct without guessing auth.
        return {
          status: 'failure',
          kind:
            error.status === 'selection-required'
              ? 'provider_configuration'
              : 'provider_unavailable',
        };
      }
      return {
        status: 'failure',
        kind:
          stage === 'data'
            ? 'retrieval_failed'
            : stage === 'selection'
              ? 'provider_unavailable'
              : 'unavailable',
      };
    } finally {
      linked.dispose();
    }
  };
}
