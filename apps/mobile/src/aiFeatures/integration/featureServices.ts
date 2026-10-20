import { createPrivateEvidenceRag } from './privateEvidenceRag';
import { withProviderStage } from '../../providers/diagnostics';
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
import { symptomSummaryTask } from '../../diseaseHypotheses/symptomSummaryTask';
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
import type {
  SymptomSummaryStorage,
  SymptomSummaryHistory,
} from '../../diseaseHypotheses/savedSummaries';
import { createSymptomSummaryPersistence } from './symptomSummaryPersistence';

export interface AiFeatureServices extends VisitQuestionSourceService {
  readonly summaryHistory?: SymptomSummaryHistory;
  summarizeSymptoms?(
    signal?: AbortSignal,
    observer?: AiWorkflowObserver,
  ): Promise<DiseaseHypothesisRunOutcome>;
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
  readonly summaryStorage?: () => Promise<SymptomSummaryStorage>;
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
  const summaryPersistence = createSymptomSummaryPersistence({
    registry,
    data: privateLocalData,
    storage: dependencies.summaryStorage,
  });
  async function selectedAi() {
    return requireSelectedAi(
      await resolveSelectedAiProvider(dependencies.selectedAi),
    );
  }

  async function analyze(
    summary: boolean,
    signal?: AbortSignal,
    observer?: AiWorkflowObserver,
  ) {
    const selected = await withProviderStage(
      'disease',
      'selection',
      selectedAi,
    );
    const data = await withProviderStage('disease', 'data', privateLocalData);
    const operationSignal = signal ?? new AbortController().signal;
    // Both explicit actions use the same bounded tools, consent and freshness boundary.
    const external = createExternalConversationEvidence(
      externalEvidence,
      dependencies.externalQueryConsent,
      { requireAbstract: true },
    );
    const tools = [
      ...toolsFor(undefined, data, registry, 6, summary),
      external.tool,
    ];
    const runId = dependencies.createOperationRunId?.() ?? operationRunId();
    const workflow = {
      ...executionOptions({
        selected,
        operationRunId: runId,
        consent,
        registry,
        tools,
        external,
        medicalExplanation: true,
      }),
      request: summary
        ? '복용약과 활동·걸음수, 혈압·심박수·체중, 수면 및 증상 기록에서 확인된 내용을 날짜와 함께 정리해 주세요. 이어서 이 기록을 이해하는 데 도움이 되는 공개 의학 문헌을 검색하고, 문헌이 설명하는 일반적인 의미를 별도 항목으로 작성해 주세요. 개인 기록의 사실과 일반 의학 설명을 구분하고 개인의 질환이나 원인으로 단정하지 마세요. 검색을 사용할 수 없다면 의학 설명은 만들지 말고 그 한계를 밝히세요.'
        : DISEASE_REQUEST,
      initialEvidence: { items: [], coverage: [], conflicts: [] },
    };
    const invocation = { ...observer, signal: operationSignal };
    const resolver = (reference: EvidenceReference) =>
      registry.resolve(reference);
    const outcome = await (summary
      ? diseaseRunner(
          workflow,
          undefined,
          invocation,
          resolver,
          symptomSummaryTask,
        )
      : diseaseRunner(workflow, undefined, invocation, resolver));
    return summary
      ? summaryPersistence.save(outcome, selected, runId, operationSignal)
      : outcome;
  }

  return {
    summaryHistory: summaryPersistence.history,
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
    generateDiseaseHypotheses: (signal, observer) =>
      analyze(false, signal, observer),
    summarizeSymptoms: (signal, observer) => analyze(true, signal, observer),
    async sendRagMessage(question, previousMessages, parentSignal, observer) {
      const normalizedQuestion = question.trim();
      if (!normalizedQuestion || normalizedQuestion.length > 1000) {
        return { status: 'unavailable' };
      }
      const linked = createLinkedAbortController(parentSignal);
      try {
        const selected = await withProviderStage(
          'rag',
          'selection',
          selectedAi,
        );
        const data = await withProviderStage('rag', 'data', privateLocalData);
        const signal = linked.controller.signal;
        const external = createExternalConversationEvidence(
          externalEvidence,
          dependencies.externalQueryConsent,
        );
        const tools = [
          ...toolsFor(undefined, data, registry, 6, true, 'rag'),
          external.tool,
        ];
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
