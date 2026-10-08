import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import type {
  EvidenceBatch,
  EvidenceReference,
  EvidenceSearchTool,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { runRagConversationTurn as defaultRagRunner } from '../../ragConversation/service';
import type { RagConversationOutcome } from '../../ragConversation/service';
import type { RagConversationMessage } from '../../ragConversation/task';
import { runDiseaseHypothesisAnalysis } from '../../diseaseHypotheses/task';
import type { DiseaseHypothesisRunOutcome } from '../../diseaseHypotheses/task';
import { createEuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import type { EuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import type { LocalE5RagService } from '../../rag/localE5RagService';
import type { AiFeatureLocalData } from './localData';
import { createLocalEvidenceSearchTool } from './evidenceSearchTool';
import {
  boundRagConversationHistory,
  createPayloadBoundedRagSearch,
  selectInitialEvidence,
} from './evidencePayload';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { EvidenceSourceReadResult } from './evidenceRegistry';
import type { LocalEvidenceSnapshot } from './evidenceSnapshot';
import {
  indexChangedFeatureEvidence,
  loadFeatureEvidenceSnapshot,
} from './featureEvidenceSnapshot';
import { requireSelectedAi, resolveSelectedAiProvider } from './provider';
import type { SelectedAiResolverOptions } from './provider';
import { loadSavedVisitQuestionState } from './savedVisitQuestions';
import type { SavedVisitQuestionsLoadState } from './savedVisitQuestions';

export interface AiFeatureServices {
  readonly externalEvidence: EuropePmcMedicalEvidenceService;
  loadSavedVisitQuestions(
    appointmentId: string,
  ): Promise<SavedVisitQuestionsLoadState>;
  generateDiseaseHypotheses(): Promise<DiseaseHypothesisRunOutcome>;
  sendRagMessage(
    question: string,
    previousMessages: readonly RagConversationMessage[],
  ): Promise<RagConversationOutcome>;
  resolveSource(reference: EvidenceReference): EvidenceReference | undefined;
  readSource(
    reference: EvidenceReference,
    signal: AbortSignal,
  ): Promise<EvidenceSourceReadResult>;
}

export interface AiFeatureServiceDependencies {
  readonly selectedAi?: SelectedAiResolverOptions;
  readonly loadLocalData?: () => Promise<AiFeatureLocalData>;
  readonly diseaseRunner?: typeof runDiseaseHypothesisAnalysis;
  readonly ragRunner?: typeof defaultRagRunner;
  readonly createOperationRunId?: () => string;
  readonly externalEvidence?: EuropePmcMedicalEvidenceService;
}

const DISEASE_REQUEST =
  '현재 앱 기록에서 검토할 수 있는 질환 가능성을 찾아 주세요. 확진하지 말고, 지지·반대 근거와 불확실성 및 더 필요한 자료를 모두 밝혀 주세요.';
let operationSequence = 0;

function operationRunId(): string {
  operationSequence += 1;
  return `ai-feature-${Date.now()}-${operationSequence}`;
}

function toolsFor(snapshot: LocalEvidenceSnapshot, data: AiFeatureLocalData) {
  return [
    createLocalEvidenceSearchTool({
      id: 'local-personal-records',
      sourceKind: 'personal_record',
      snapshot,
      rag: data.rag,
    }),
    createLocalEvidenceSearchTool({
      id: 'local-reviewed-memory',
      sourceKind: 'reviewed_memory',
      snapshot,
      rag: data.rag,
    }),
  ] as const;
}

function executionOptions(input: {
  readonly selected: ReturnType<typeof requireSelectedAi>;
  readonly operationRunId: string;
  readonly consent: MultiAgentWorkflowOptions['consent'];
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly tools: readonly EvidenceSearchTool[];
}) {
  return {
    execution: {
      operationRunId: input.operationRunId,
      providerId: input.selected.provider.id,
      modelId: input.selected.modelId,
      recipient: input.selected.recipient,
      remoteProcessing: input.selected.remoteProcessing,
      allowedScope: {
        sourceKinds: ['personal_record', 'reviewed_memory'] as const,
      },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    },
    provider: input.selected.provider,
    tools: input.tools,
    consent: input.consent,
    revalidateEvidence: (
      references: readonly EvidenceReference[],
      signal: AbortSignal,
    ) => input.registry.revalidateEvidence(references, signal),
  };
}

/** Connects selected-AI operations and freshly revalidated local citations to owned feature screens. */
export function createAiFeatureServices(
  consent: MultiAgentWorkflowOptions['consent'],
  dependencies: AiFeatureServiceDependencies = {},
): AiFeatureServices {
  const registry = new LocalEvidenceReferenceRegistry();
  const loadLocalData =
    dependencies.loadLocalData ??
    (async () => (await import('./localData')).openAiFeatureLocalData());
  const diseaseRunner =
    dependencies.diseaseRunner ?? runDiseaseHypothesisAnalysis;
  const ragRunner = dependencies.ragRunner ?? defaultRagRunner;

  async function selectedAi() {
    return requireSelectedAi(
      await resolveSelectedAiProvider(dependencies.selectedAi),
    );
  }

  return {
    externalEvidence:
      dependencies.externalEvidence ?? createEuropePmcMedicalEvidenceService(),
    async loadSavedVisitQuestions(appointmentId) {
      const data = await loadLocalData();
      const { openLocalStorage } = await import('../../storage/secureDatabase');
      return loadSavedVisitQuestionState({
        appointmentId,
        records: await openLocalStorage(),
        sourceReader: data.repository,
        registry,
      });
    },
    async generateDiseaseHypotheses() {
      const selected = await selectedAi();
      const data = await loadLocalData();
      const signal = new AbortController().signal;
      const snapshot = await loadFeatureEvidenceSnapshot(
        data,
        registry,
        signal,
      );
      await indexChangedFeatureEvidence(data, snapshot, signal);
      let hits: Awaited<ReturnType<LocalE5RagService['search']>> = [];
      try {
        hits = await data.rag.search(DISEASE_REQUEST, snapshot.chunks, 8, {
          signal,
        });
      } catch {
        // Empty initial evidence lets the runtime ask its local tools; validators reject unsupported claims.
      }
      const evidence = selectInitialEvidence(snapshot, hits);
      const tools = toolsFor(snapshot, data);
      const runId = dependencies.createOperationRunId?.() ?? operationRunId();
      const workflow = {
        ...executionOptions({
          selected,
          operationRunId: runId,
          consent,
          registry,
          tools,
        }),
        request: DISEASE_REQUEST,
        initialEvidence: evidence,
      };
      const diseaseInventory = snapshot.gaps.length
        ? { ...snapshot.inventory, inventoryComplete: false }
        : snapshot.inventory;
      return diseaseRunner(workflow, diseaseInventory, { signal });
    },
    async sendRagMessage(question, previousMessages) {
      const normalizedQuestion = question.trim();
      if (!normalizedQuestion || normalizedQuestion.length > 1000) {
        return { status: 'unavailable' };
      }
      const selected = await selectedAi();
      const data = await loadLocalData();
      const controller = new AbortController();
      const snapshot = await loadFeatureEvidenceSnapshot(
        data,
        registry,
        controller.signal,
      );
      if (snapshot.gaps.length) return { status: 'insufficient' };
      await indexChangedFeatureEvidence(data, snapshot, controller.signal);
      const tools = toolsFor(snapshot, data);
      const runId = dependencies.createOperationRunId?.() ?? operationRunId();
      const batch: {
        items: EvidenceBatch['items'];
        coverage: EvidenceBatch['coverage'];
        conflicts: EvidenceBatch['conflicts'];
      } = {
        items: [...snapshot.items],
        coverage: snapshot.coverage.map(coverage => ({
          ...coverage,
          searchedSourceIds: [],
          resultLimit: 5,
          returnedCount: 0,
        })),
        conflicts: [],
      };
      const boundedRag = createPayloadBoundedRagSearch({
        rag: data.rag,
        snapshot,
        abort: () => controller.abort(),
        onSelection: selection => {
          batch.coverage = selection.coverage;
        },
      });
      const outcome = await ragRunner(
        {
          question: normalizedQuestion,
          previousMessages: boundRagConversationHistory(previousMessages),
          loadCurrentEvidence: async () => ({ batch, chunks: snapshot.chunks }),
          rag: boundedRag.rag,
          workflow: executionOptions({
            selected,
            operationRunId: runId,
            consent,
            registry,
            tools,
          }),
        },
        { signal: controller.signal },
      );
      return boundedRag.didOmitEvidence()
        ? { status: 'insufficient' }
        : outcome;
    },
    resolveSource: reference => registry.resolve(reference),
    readSource: (reference, signal) => registry.readSource(reference, signal),
  };
}
