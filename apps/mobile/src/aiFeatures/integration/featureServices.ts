import { operationRunId } from './featureRunIdentity';
import { publicMedicalQueryConsent } from '../../agent/execution/publicMedicalQueryConsent';
import { createPrivateEvidenceRag } from './privateEvidenceRag';
import { withProviderStage } from '../../providers/diagnostics';
import { createSelectedExternalEvidence } from './selectedExternalEvidence';
import type {
  EvidenceReference,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { AiWorkflowObserver } from '../../agent/workflowActivity';
import { runRagConversationTurn as defaultRagRunner } from '../../ragConversation/service';
import { runDiseaseHypothesisAnalysis } from '../../diseaseHypotheses/task';
import { symptomSummaryTaskForProvider } from '../../diseaseHypotheses/partitionedSymptomSummaryTask';
import { createEuropePmcMedicalEvidenceService } from '../../externalMedicalEvidence/europePmc';
import type { AiFeatureLocalData } from './localData';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { requireSelectedAi, resolveSelectedAiProvider } from './provider';
import { loadSavedVisitQuestionState } from './savedVisitQuestions';
import { createVisitQuestionSourceService } from './visitQuestionSourceRegistration';
import { executionOptions, toolsFor } from './featureServiceExecution';
import { createSymptomSummaryPersistence } from './symptomSummaryPersistence';
import { createRagConversationService } from './ragConversationService';
import { createConversationSessionOptions } from './conversationSessionOptions';
import { conversationGeneratedTools } from './conversationGeneratedTools';
import { retainLiteratureResults } from './researchRetention';
import { createResearchInputTracker } from './researchInputTracker';
import type { AiFeatureServiceDependencies } from './featureServiceDependencies';
export type { AiFeatureServiceDependencies } from './featureServiceDependencies';

import type { AiFeatureServices } from './featureServiceTypes';
export type { AiFeatureServices } from './featureServiceTypes';

const DISEASE_REQUEST =
  '현재 앱 기록에서 검토할 수 있는 질환 가능성을 찾아 주세요. 확진하지 말고, 지지·반대 근거와 불확실성 및 더 필요한 자료를 모두 밝혀 주세요.';
/** Connects selected AI, durable conversation sessions and revalidated local citations to feature screens. */
export function createAiFeatureServices(
  consent: MultiAgentWorkflowOptions['consent'],
  dependencies: AiFeatureServiceDependencies = {},
): AiFeatureServices {
  const registry = new LocalEvidenceReferenceRegistry();
  const queryConsent =
    dependencies.externalQueryConsent ?? publicMedicalQueryConsent(consent);
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
  const literatureService =
    dependencies.externalEvidence ?? createEuropePmcMedicalEvidenceService();
  const externalEvidence = retainLiteratureResults(
    literatureService,
    privateLocalData,
  );
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
    const researchInputs = createResearchInputTracker(registry, data);
    // Both explicit actions use the same bounded tools, consent and freshness boundary.
    const external = createSelectedExternalEvidence({
      selected,
      consent,
      literature: retainLiteratureResults(
        literatureService,
        privateLocalData,
        summary ? 'symptom_summary' : 'disease_hypotheses',
        undefined,
        researchInputs.recordResearch,
        { providerId: selected.provider.id, modelId: selected.modelId },
      ),
      literatureConsent: queryConsent,
      requireAbstract: true,
      loadData: privateLocalData,
      originFeature: summary ? 'symptom_summary' : 'disease_hypotheses',
      captureResearchInputs: researchInputs.capture,
      validateResearchInputs: researchInputs.revalidate,
      onResearchRetained: researchInputs.recordResearch,
    });
    const tools = [
      ...researchInputs.wrap([
        ...toolsFor(undefined, data, registry, 6, summary),
        ...conversationGeneratedTools(data, registry, undefined).tools,
      ]),
      ...external.tools,
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
        consentPurpose: summary ? 'symptom_summary' : 'disease_hypotheses',
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
          symptomSummaryTaskForProvider(selected.provider.id),
        )
      : diseaseRunner(workflow, undefined, invocation, resolver));
    // Both actions produce durable results; presentation remains part of the
    // saved analysis so reopening possibilities cannot turn them into factual summaries.
    return summaryPersistence.save(outcome, selected, runId, operationSignal);
  }

  const sendRagMessage = createRagConversationService({
    consent,
    queryConsent,
    externalEvidence: literatureService,
    loadLocalData: privateLocalData,
    selectedAi,
    registry,
    ragRunner,
    createOperationRunId: dependencies.createOperationRunId,
  });

  return {
    async generatedArtifactTools() {
      const data = await privateLocalData();
      return {
        tools: conversationGeneratedTools(data, registry, undefined).tools,
        validate: (references, signal) =>
          registry.revalidateEvidence(references, signal),
        owns: reference => Boolean(registry.resolve(reference)),
      };
    },
    conversationSessionOptions() {
      return createConversationSessionOptions({
        loadLocalData: privateLocalData,
        registry,
      });
    },
    async conversationArtifacts() {
      const data = await privateLocalData();
      return data.conversationArtifactDiscovery
        ? data.conversationArtifactDiscovery(registry)
        : null;
    },
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
        readHealthContext: data.readHealthContext,
        data,
      });
    },
    generateDiseaseHypotheses: (signal, observer) =>
      analyze(false, signal, observer),
    summarizeSymptoms: (signal, observer) => analyze(true, signal, observer),
    sendRagMessage,
    resolveSource: reference => registry.resolve(reference),
    readSource: (reference, signal) => registry.readSource(reference, signal),
  };
}
