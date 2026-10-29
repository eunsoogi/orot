import type {
  EvidenceSearchTool,
  MultiAgentInvocation,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { ExternalMedicalQueryConsentPort } from '@orot/agent-runtime';
import { loadLocalHealthKitAutoSyncStatus } from '../../healthkit/autoSyncLocal';
import { isRagConversationAvailabilityQuestion } from '../../ragConversation/availabilityIntent';
import { runRagConversationTurn as defaultRagRunner } from '../../ragConversation/service';
import type { RagConversationOutcome } from '../../ragConversation/service';
import type { RagConversationMessage } from '../../ragConversation/task';
import type { AiFeatureLocalData } from './localData';
import { boundRagConversationHistory } from './evidencePayload';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { executionOptions, toolsFor } from './featureServiceExecution';
import { createLinkedAbortController } from './linkedAbortController';
import { createSelectedExternalEvidence } from './selectedExternalEvidence';
import { operationRunId } from './featureRunIdentity';
import type { EuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import { withProviderStage } from '../../providers/diagnostics';
import {
  AiProviderSelectionError,
  type SelectedAiResolution,
} from './provider';
import { describeLocalRecordAvailability } from './ragConversationAvailability';

type ReadySelectedAi = Extract<
  SelectedAiResolution,
  { readonly status: 'ready' }
>;
type RagObserver = Pick<
  MultiAgentInvocation,
  'onProgress' | 'onTaskStreamEvent'
>;

const LOCAL_SEARCH_FAILURE_GAP =
  '로컬 검색을 사용할 수 없어 근거를 찾지 못했어요.';

/** Tracks only the fixed safe gap emitted when a local search suppresses its exception. */
function observeLocalSearchFailures(
  tools: readonly EvidenceSearchTool[],
  onFailure: () => void,
): readonly EvidenceSearchTool[] {
  return tools.map(tool => {
    if (tool.execution !== 'local_read_only') return tool;
    return {
      ...tool,
      async search(...args: Parameters<EvidenceSearchTool['search']>) {
        const outcome = await tool.search(...args);
        if (
          'coverage' in outcome &&
          outcome.coverage.some(coverage =>
            coverage.gaps.includes(LOCAL_SEARCH_FAILURE_GAP),
          )
        ) {
          onFailure();
        }
        return outcome;
      },
    };
  });
}

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
      if (isRagConversationAvailabilityQuestion(normalizedQuestion)) {
        stage = 'data';
        const data = await withProviderStage('rag', 'data', loadLocalData);
        const inventory = await withProviderStage('rag', 'data', () =>
          data.repository.readInventory({ signal }),
        );
        // Manual history has its own table and is not represented in structured inventory.
        const manualHistory = await withProviderStage('rag', 'data', () =>
          data.manualHistory.listEvidence({ limit: 1 }),
        );
        let syncStatus = null;
        try {
          syncStatus = await withProviderStage(
            'rag',
            'data',
            loadLocalHealthKitAutoSyncStatus,
          );
        } catch (error) {
          // Sync status is optional; an interrupted request remains a cancellation.
          if (
            signal.aborted ||
            (error instanceof Error && error.name === 'AbortError')
          )
            throw error;
        }
        if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
        return {
          status: 'answer',
          answer: describeLocalRecordAvailability(
            inventory,
            syncStatus,
            manualHistory.length > 0,
          ),
          citations: [],
        };
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
      const tools = [
        ...observeLocalSearchFailures(
          toolsFor(undefined, data, registry, 6, true, 'rag'),
          () => {
            localRetrievalFailed = true;
          },
        ),
        ...external.tools,
      ];
      const runId = createOperationRunId?.() ?? operationRunId();
      stage = 'workflow';
      const outcome = await ragRunner(
        {
          question: normalizedQuestion,
          previousMessages: boundRagConversationHistory(previousMessages),
          loadCurrentEvidence: async () => ({
            batch: { items: [], coverage: [], conflicts: [] },
            chunks: [],
          }),
          rag: data.rag,
          resolveLocalEvidenceIdentity: reference =>
            registry.resolve(reference),
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
        { ...observer, signal },
      );
      if (signal.aborted) return { status: 'failure', kind: 'cancelled' };
      if (
        localRetrievalFailed &&
        (outcome.status === 'no_evidence' || outcome.status === 'insufficient')
      ) {
        return { status: 'failure', kind: 'retrieval_failed' };
      }
      return outcome;
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
