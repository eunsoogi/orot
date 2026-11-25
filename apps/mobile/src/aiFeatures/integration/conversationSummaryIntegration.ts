import { hasConversationMemoryCommand } from '../../manualHistory/conversationHistoryIntent';
import { conversationTemplateTarget } from './conversationTemplateTarget';
import { proposeConversationTemplate } from './conversationTemplateProposal';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { t } from '../../i18n';
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
      const [question, history, signal, originalObserver, originalContext] =
        args;
      const operationSignal = signal ?? new AbortController().signal;
      if (originalObserver?.selectedRecordingTranscript) {
        // An attachment cannot inherit an unrelated feature or local-memory action.
        // Explicit local commands must not fall through to a remote recipient.
        if (operationSignal.aborted || hasConversationMemoryCommand(question))
          return {
            status: 'failure',
            kind: operationSignal.aborted ? 'cancelled' : 'validation_failed',
          } as const;
        return input.sendRagMessage(...args);
      }
      // Preserve the old no-transfer boundary without using its grammar to
      // decide what to store. Only the already-selected on-device model can
      // interpret a request previously intercepted as local-only.
      const protectedLocalInput =
        originalObserver?.inputOrigin === 'composer' &&
        !originalObserver.photoInput &&
        hasConversationMemoryCommand(question);
      if (
        protectedLocalInput &&
        originalObserver?.expectedConversationModel?.providerId !==
          APPLE_PROVIDER_ID
      )
        return {
          status: 'answer',
          answer: t('historyDisplay.answerMemoryDeviceOnly'),
          citations: [],
        } as const;
      if (protectedLocalInput)
        return input.sendRagMessage(question, history, signal, {
          ...originalObserver,
          protectedLocalInput: true,
          suppressContextualOpening: true,
        });
      let observer = originalObserver;
      let context = originalContext;
      const admission = observer?.modelTemplateAdmission;
      if (
        admission &&
        (!context || context.intent === 'conversation') &&
        !context?.appointmentId &&
        !context?.dailyReport
      ) {
        const proposed = await proposeConversationTemplate({
          question,
          signal: operationSignal,
          observer,
          select: input.selectedAi,
          consent: input.consent,
        });
        if (
          operationSignal.aborted ||
          !admission.current() ||
          originalObserver?.expectedConversationModel?.isCurrent?.() ===
            false ||
          proposed?.ownerChanged ||
          (proposed?.intent !== undefined &&
            !originalObserver?.templateProposalOwner?.current())
        )
          return { status: 'failure', kind: 'cancelled' } as const;
        if (proposed?.spent)
          observer = { ...observer, suppressContextualOpening: true };
        const target = conversationTemplateTarget(
          proposed?.intent,
          admission,
          Boolean(report),
        );
        if (target?.intent === 'visit-questions' && admission.prepareVisit)
          return admission.prepareVisit(
            question,
            history,
            signal,
            observer,
            target,
          );
        if (target) context = target;
      }
      if (
        context?.intent === 'daily-report' &&
        context.reportRequest &&
        !observer?.photoInput
      )
        return report
          ? report(
              question,
              context.reportRequest,
              operationSignal,
              observer,
              context.directDailyReportRequest === true,
            )
          : ({ status: 'failure', kind: 'unavailable' } as const);
      return context?.intent === 'health-summary' && !observer?.photoInput
        ? summarize({ question }, operationSignal, observer)
        : input.sendRagMessage(question, history, signal, observer, context);
    },
  };
}
