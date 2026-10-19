import { createPrivateEvidenceRag } from './privateEvidenceRag';
import { createExternalConversationEvidence } from './externalConversationEvidence';
import type { ExternalMedicalQueryConsentPort } from '@orot/agent-runtime';
import type {
  EvidenceReference,
  MultiAgentInvocation,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { AiWorkflowObserver } from '../../agent/workflowActivity';
import { runRagConversationTurn as defaultRagRunner } from '../../ragConversation/service';
import type { RagConversationOutcome } from '../../ragConversation/service';
import type { RagConversationMessage } from '../../ragConversation/task';
import { runDiseaseHypothesisAnalysis } from '../../diseaseHypotheses/task';
import type { DiseaseHypothesisRunOutcome } from '../../diseaseHypotheses/task';
import { createEuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import type { EuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import type { AiFeatureLocalData } from './localData';
import { boundRagConversationHistory } from './evidencePayload';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { EvidenceSourceReadResult } from './evidenceRegistry';
import { requireSelectedAi, resolveSelectedAiProvider } from './provider';
import type { SelectedAiResolverOptions } from './provider';
import { loadSavedVisitQuestionState } from './savedVisitQuestions';
import type { SavedVisitQuestionsLoadState } from './savedVisitQuestions';
import { createVisitQuestionSourceService } from './visitQuestionSourceRegistration';
import { executionOptions, toolsFor } from './featureServiceExecution';
import { createLinkedAbortController } from './linkedAbortController';
import type { VisitQuestionSourceService } from './visitQuestionSourceRegistration';

export interface AiFeatureServices extends VisitQuestionSourceService {
  readonly externalEvidence: EuropePmcMedicalEvidenceService;
  loadSavedVisitQuestions(
    appointmentId: string,
  ): Promise<SavedVisitQuestionsLoadState>;
  generateDiseaseHypotheses(
    signal?: AbortSignal,
    observer?: AiWorkflowObserver,
  ): Promise<DiseaseHypothesisRunOutcome>;
  sendRagMessage(
    question: string,
    previousMessages: readonly RagConversationMessage[],
    signal?: AbortSignal,
    observer?: Pick<MultiAgentInvocation, 'onProgress' | 'onTaskStreamEvent'>,
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
  readonly externalQueryConsent?: ExternalMedicalQueryConsentPort;
}

const DISEASE_REQUEST =
  '현재 앱 기록에서 검토할 수 있는 질환 가능성을 찾아 주세요. 확진하지 말고, 지지·반대 근거와 불확실성 및 더 필요한 자료를 모두 밝혀 주세요.';
let operationSequence = 0;

function operationRunId(): string {
  operationSequence += 1;
  return `ai-feature-${Date.now()}-${operationSequence}`;
}

/** Connects selected-AI operations and freshly revalidated local citations to owned feature screens. */
export function createAiFeatureServices(
  consent: MultiAgentWorkflowOptions['consent'],
  dependencies: AiFeatureServiceDependencies = {},
): AiFeatureServices {
  const registry = new LocalEvidenceReferenceRegistry();
  const externalEvidence =
    dependencies.externalEvidence ?? createEuropePmcMedicalEvidenceService();
  const loadLocalData =
    dependencies.loadLocalData ??
    (async () => (await import('./localData')).openAiFeatureLocalData());
  const localDataCache = new WeakMap<AiFeatureLocalData, AiFeatureLocalData>();
  async function privateLocalData() {
    const data = await loadLocalData();
    let wrapped = localDataCache.get(data);
    if (!wrapped) {
      wrapped = { ...data, rag: createPrivateEvidenceRag(data.rag, registry) };
      localDataCache.set(data, wrapped);
    }
    return wrapped;
  }
  const diseaseRunner =
    dependencies.diseaseRunner ?? runDiseaseHypothesisAnalysis;
  const ragRunner = dependencies.ragRunner ?? defaultRagRunner;
  async function selectedAi() {
    return requireSelectedAi(
      await resolveSelectedAiProvider(dependencies.selectedAi),
    );
  }

  return {
    ...createVisitQuestionSourceService(registry, loadLocalData),
    externalEvidence,
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
    async generateDiseaseHypotheses(signal, observer) {
      const selected = await selectedAi();
      const data = await privateLocalData();
      const operationSignal = signal ?? new AbortController().signal;
      // Records are read only after the selected model requests an allowlisted tool.
      const tools = toolsFor(undefined, data, registry);
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
        initialEvidence: { items: [], coverage: [], conflicts: [] },
      };
      return diseaseRunner(
        workflow,
        undefined,
        {
          ...observer,
          signal: operationSignal,
        },
        reference => registry.resolve(reference),
      );
    },
    async sendRagMessage(question, previousMessages, parentSignal, observer) {
      const normalizedQuestion = question.trim();
      if (!normalizedQuestion || normalizedQuestion.length > 1000) {
        return { status: 'unavailable' };
      }
      const linked = createLinkedAbortController(parentSignal);
      try {
        const selected = await selectedAi();
        const data = await privateLocalData();
        const signal = linked.controller.signal;
        const external = createExternalConversationEvidence(
          externalEvidence,
          dependencies.externalQueryConsent,
        );
        const tools = [...toolsFor(undefined, data, registry), external.tool];
        const runId = dependencies.createOperationRunId?.() ?? operationRunId();
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
        return outcome;
      } finally {
        linked.dispose();
      }
    },
    resolveSource: reference => registry.resolve(reference),
    readSource: (reference, signal) => registry.readSource(reference, signal),
  };
}
