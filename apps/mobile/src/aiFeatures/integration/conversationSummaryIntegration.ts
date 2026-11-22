import { trySaveExplicitConversationMemory } from './saveExplicitConversationMemory';
import { createConversationDailyReport } from './conversationDailyReport';
import type { MultiAgentWorkflowOptions } from '@orot/agent-runtime';
import type { runDiseaseHypothesisAnalysis } from '../../diseaseHypotheses/task';
import type { AiFeatureServiceDependencies } from './featureServiceDependencies';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { requireSelectedAi } from './provider';
import type { createRagConversationService } from './ragConversationService';
import { createHealthSummaryService } from './healthSummaryService';
import { createConversationHealthSummary } from './conversationHealthSummary';
import { captureNativeConversationSelectionWitness } from './conversationNativeSelectionWitness';
import { createConversationSessionOptions } from './conversationSessionOptions';
import { openSummaryStorage } from './symptomSummaryPersistence';
import { restoreHealthSummary } from './restoreHealthSummary';
import { operationRunId } from './featureRunIdentity';
import { appOrdinaryConversationMemory } from './appOrdinaryConversationMemory';

/** Wire only an explicit summary turn to its own generation, storage and retry operation. */
export function createConversationSummaryIntegration(input: {
  dailyReport?: Parameters<typeof createConversationDailyReport>[0]['feature'];
  dailyReportSources?: Parameters<
    typeof createConversationDailyReport
  >[0]['sources'];
  coldResume?: import('../../ragConversation/conversationSessionTypes').ConversationSessionOptions['coldResume'];
  consent: MultiAgentWorkflowOptions['consent'];
  ordinaryMemory?: boolean;
  dependencies: AiFeatureServiceDependencies;
  loadData: () => Promise<AiFeatureLocalData>;
  selectedAi: () => Promise<ReturnType<typeof requireSelectedAi>>;
  registry: LocalEvidenceReferenceRegistry;
  diseaseRunner: typeof runDiseaseHypothesisAnalysis;
  sendRagMessage: ReturnType<typeof createRagConversationService>;
  loadSavedVisitQuestions: import('./featureServices').AiFeatureServices['loadSavedVisitQuestions'];
}) {
  const report =
    input.dailyReport && input.dailyReportSources
      ? createConversationDailyReport({
          feature: input.dailyReport,
          sources: input.dailyReportSources,
          registry: input.registry,
        })
      : undefined;
  const summarize = createConversationHealthSummary(
    createHealthSummaryService({
      selectedAi: input.selectedAi,
      loadData: input.loadData,
      registry: input.registry,
      consent: input.consent,
      runner: input.diseaseRunner,
      storage: input.dependencies.summaryStorage,
      createRunId: input.dependencies.createOperationRunId ?? operationRunId,
    }),
  );
  return {
    conversationSessionOptions: () =>
      createConversationSessionOptions({
        loadLocalData: input.loadData,
        ordinaryMemory: input.ordinaryMemory
          ? appOrdinaryConversationMemory
          : undefined,
        coldResume: input.coldResume,
        registry: input.registry,
        selectedAi: input.selectedAi,
        captureSelectionWitness: () =>
          captureNativeConversationSelectionWitness(
            input.dependencies.selectedAi,
          ),
        loadSavedVisitQuestions: input.loadSavedVisitQuestions,
        restoreHealthSummary: async reference =>
          restoreHealthSummary({
            reference,
            registry: input.registry,
            data: await input.loadData(),
            storage: await (
              input.dependencies.summaryStorage ?? openSummaryStorage
            )(),
          }),
      }),
    sendRagMessage: async (
      ...args: Parameters<ReturnType<typeof createRagConversationService>>
    ) => {
      const [question, , signal, observer, context] = args;
      const localMemory = trySaveExplicitConversationMemory(
        question,
        observer,
        input.loadData,
        signal ?? new AbortController().signal,
      );
      if (localMemory) return localMemory;
      if (
        context?.intent === 'daily-report' &&
        context.reportRequest &&
        !observer?.photoInput
      )
        return report
          ? report(
              question,
              context.reportRequest,
              signal ?? new AbortController().signal,
              observer,
              context.directDailyReportRequest === true,
            )
          : ({ status: 'failure', kind: 'unavailable' } as const);
      return context?.intent === 'health-summary' && !observer?.photoInput
        ? summarize(
            { question },
            signal ?? new AbortController().signal,
            observer,
          )
        : input.sendRagMessage(...args);
    },
  };
}
