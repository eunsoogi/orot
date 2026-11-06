import type { MultiAgentWorkflowOptions } from '@orot/agent-runtime';
import type { runDiseaseHypothesisAnalysis } from '../../diseaseHypotheses/task';
import type { AiFeatureServiceDependencies } from './featureServiceDependencies';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { requireSelectedAi } from './provider';
import type { createRagConversationService } from './ragConversationService';
import { createHealthSummaryService } from './healthSummaryService';
import { createConversationHealthSummary } from './conversationHealthSummary';
import { createConversationSessionOptions } from './conversationSessionOptions';
import { openSummaryStorage } from './symptomSummaryPersistence';
import { restoreHealthSummary } from './restoreHealthSummary';
import { operationRunId } from './featureRunIdentity';

/** Wire only an explicit summary turn to its own generation, storage and retry operation. */
export function createConversationSummaryIntegration(input: {
  consent: MultiAgentWorkflowOptions['consent'];
  dependencies: AiFeatureServiceDependencies;
  loadData: () => Promise<AiFeatureLocalData>;
  selectedAi: () => Promise<ReturnType<typeof requireSelectedAi>>;
  registry: LocalEvidenceReferenceRegistry;
  diseaseRunner: typeof runDiseaseHypothesisAnalysis;
  sendRagMessage: ReturnType<typeof createRagConversationService>;
}) {
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
        registry: input.registry,
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
      return context?.intent === 'health-summary'
        ? summarize(
            { question },
            signal ?? new AbortController().signal,
            observer,
          )
        : input.sendRagMessage(...args);
    },
  };
}
