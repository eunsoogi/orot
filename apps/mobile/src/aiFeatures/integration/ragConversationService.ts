import type { MultiAgentWorkflowOptions } from '@orot/agent-runtime';
import type { ExternalMedicalQueryConsentPort } from '@orot/agent-runtime';
import { isRagConversationAvailabilityQuestion } from '../../ragConversation/availabilityIntent';
import { runRagConversationTurn as defaultRagRunner } from '../../ragConversation/service';
import type { RagConversationOutcome } from '../../ragConversation/service';
import type { RagConversationObserver } from '../../ragConversation/service';
import { requestsArtifactContinuation } from '../../ragConversation/artifactContinuation';
import { continueArtifactSearch } from './continueArtifactSearch';
import type { RagConversationMessage } from '../../ragConversation/task';
import type { AiFeatureLocalData } from './localData';
import { boundRagConversationHistory } from './evidencePayload';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { executionOptions, toolsFor } from './featureServiceExecution';
import { createLinkedAbortController } from './linkedAbortController';
import { createSelectedExternalEvidence } from './selectedExternalEvidence';
import { operationRunId } from './featureRunIdentity';
import { createSummaryArtifactTool } from './summaryArtifactTool';
import { createArtifactSourceTool } from './artifactSourceTool';
import type { EuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import { withProviderStage } from '../../providers/diagnostics';
import {
  AiProviderSelectionError,
  type SelectedAiResolution,
} from './provider';
import { readConversationAvailability } from './readConversationAvailability';
import { observeLocalSearchFailures } from './observeLocalSearchFailures';
import { createConversationRetentionBridge } from './conversationRetentionBridge';

type ReadySelectedAi = Extract<
  SelectedAiResolution,
  { readonly status: 'ready' }
>;
type RagObserver = RagConversationObserver;

interface RagConversationServiceDependencies {
  readonly consent: MultiAgentWorkflowOptions['consent'];
  readonly queryConsent: ExternalMedicalQueryConsentPort;
  readonly externalEvidence: EuropePmcMedicalEvidenceService;
  readonly loadLocalData: () => Promise<AiFeatureLocalData>;
  readonly selectedAi: () => Promise<ReadySelectedAi>;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly ragRunner: typeof defaultRagRunner;
  readonly createOperationRunId?: () => string;
}

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
    observer?: RagObserver,
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
      const external = createSelectedExternalEvidence({
        selected,
        consent,
        literature: externalEvidence,
        literatureConsent: queryConsent,
      });
      let localRetrievalFailed = false;
      let hasArtifactContinuation = false;
      const generatedTools = data.summaryArtifactDiscovery
        ? [
            createSummaryArtifactTool(data, registry, {
              scope: observer?.conversationScope,
              onPage: (query, cursor) => {
                hasArtifactContinuation = Boolean(
                  cursor && observer?.conversationScope,
                );
                if (observer?.conversationScope)
                  observer.onArtifactContinuation?.(
                    cursor ? { query, cursor } : null,
                  );
              },
            }),
            createArtifactSourceTool('personal_record', data, registry),
            createArtifactSourceTool('reviewed_memory', data, registry),
          ]
        : [];
      const tools = [
        ...observeLocalSearchFailures(
          [
            ...toolsFor(undefined, data, registry, 6, true, 'rag'),
            ...generatedTools,
          ],
          () => {
            localRetrievalFailed = true;
          },
        ),
        ...external.tools,
      ];
      const runId = createOperationRunId?.() ?? operationRunId();
      const retention = createConversationRetentionBridge({
        observer,
        registry,
        question: normalizedQuestion,
        providerId: selected.provider.id,
        modelId: selected.modelId,
        signal,
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
          resolveLocalEvidenceIdentity: reference =>
            registry.resolve(reference),
          readHistoricalArtifact: (reference, readSignal) =>
            registry.readSource(reference, readSignal),
          workflow: executionOptions({
            consentPurpose: 'record_conversation',
            selected,
            operationRunId: runId,
            consent,
            registry,
            tools,
            external,
          }),
        },
        {
          onProgress: observer?.onProgress,
          onTaskStreamEvent: observer?.onTaskStreamEvent,
          signal,
        },
      );
      if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
      if (
        hasArtifactContinuation &&
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
      const finished = await retention.finish(outcome);
      return signal.aborted && !finished.retained
        ? { status: 'failure', kind: 'cancelled' }
        : finished.outcome;
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
