import { useAppointmentReminderRuntime } from '../../appointmentReminders/AppointmentReminderContext';
import { conversationIntentForRoute } from './conversationIntent';
import { AiProviderSelectorRow } from './AiProviderSelectorRow';
import { SummaryHistoryScreen } from '../../diseaseHypotheses/SummaryHistoryScreen';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';
import type { ReactElement } from 'react';
import type {
  EvidenceItem,
  EvidenceReference,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { DiseaseHypothesesScreen } from '../../diseaseHypotheses/DiseaseHypothesesScreen';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { ConversationHistoryScreen } from '../../ragConversation/ConversationHistoryScreen';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';
import type { AiFeatureServices } from './featureServices';
import type { SelectedAiResolution } from './provider';
import type { FeatureScreenRoute } from './aiFeatureNavigation';
import type { AiFeatureNavigationStateChange } from './useAiFeatureNavigationState';
import { useColorScheme } from 'react-native';
import { createNextVisitQuestionsTheme } from './nextVisitQuestionsRoutePresentation';
import { ConversationVisitQuestionCard } from './ConversationVisitQuestionCard';
import { defaultVisitQuestionRouteOperations } from './visitQuestionsRouteOperations';

export interface VisitQuestionsRenderInput {
  readonly readOnly?: boolean;
  readonly navigationRouteKey?: string;
  readonly onBack: () => void;
  readonly onOpenProviderSelection: () => void;
  readonly onOpenSource: (reference: EvidenceItem) => void;
  readonly onRouteStateChange: (state: VisitQuestionsRouteState) => void;
  readonly resolveSelectedAi: () => Promise<SelectedAiResolution>;
  readonly confirmConsent: (
    request: OutboundProcessingRequest,
  ) => Promise<boolean>;
  readonly resolveSource: AiFeatureServices['resolveSource'];
  readonly generatedArtifactTools?: AiFeatureServices['generatedArtifactTools'];
  readonly registerVisitQuestionSource: AiFeatureServices['registerVisitQuestionSource'];
  readonly selectedAiRevision: number;
  readonly loadSavedVisitQuestions: AiFeatureServices['loadSavedVisitQuestions'];
}

/** Carries draft and save revisions back to navigation so stale prompts cannot leave. */
export interface VisitQuestionsRouteState {
  readonly hasUnsavedChanges: boolean;
  readonly isSaving: boolean;
  /** Reports activity for presentation; the retained visit owner survives navigation. */
  readonly isGenerating: boolean;
  readonly revision: number;
}

export interface AiFeatureFlowScreenProps {
  readonly articleOpenError?: boolean;
  readonly onOpenSavedAnalysis?: () => void;
  readonly onOpenSavedVisitQuestions?: () => void;
  readonly onOpenSummaryHistory?: () => void;
  readonly onRestoreSummary?: (value: DiseaseHypothesisAnalysis) => void;
  readonly restoredSummary?: DiseaseHypothesisAnalysis;
  readonly route: FeatureScreenRoute;
  readonly navigationRouteKey?: string;
  readonly onFeatureNavigationStateChange?: AiFeatureNavigationStateChange;
  readonly renderVisitQuestions?: (
    input: VisitQuestionsRenderInput,
  ) => ReactElement;
  readonly onRouteStateChange: (state: VisitQuestionsRouteState) => void;
  readonly onBack: () => void;
  readonly onOpenVisitQuestions?: () => void;
  readonly onOpenDiseaseHypotheses: () => void;
  readonly onOpenRagConversation: () => void;
  readonly onOpenExternalEvidence: () => void;
  readonly onOpenConversationHistory?: () => void;
  readonly onOpenProviderSelection: () => void;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly resolveSelectedAi: () => Promise<SelectedAiResolution>;
  readonly confirmConsent: (
    request: OutboundProcessingRequest,
  ) => Promise<boolean>;
  readonly selectedAiRevision: number;
  readonly services: AiFeatureServices;
  readonly onOpenArticle: (publication: ExternalMedicalPublication) => void;
}

/** Renders one stack destination while the parent keeps source/provider overlays mounted above it. */
export function AiFeatureFlowScreen({
  onOpenSavedAnalysis,
  onOpenSavedVisitQuestions,
  onOpenSummaryHistory,
  onRestoreSummary,
  restoredSummary,
  route,
  navigationRouteKey,
  onFeatureNavigationStateChange,
  renderVisitQuestions,
  onRouteStateChange,
  onBack,
  onOpenProviderSelection,
  onOpenConversationHistory,
  onOpenSource,
  resolveSelectedAi,
  confirmConsent,
  selectedAiRevision,
  services,
}: AiFeatureFlowScreenProps) {
  const providerSelection = (
    <AiProviderSelectorRow
      embedded
      onPress={onOpenProviderSelection}
      resolveSelectedAi={resolveSelectedAi}
      revision={selectedAiRevision}
    />
  );
  const intent = conversationIntentForRoute(route);
  const reminderRuntime = useAppointmentReminderRuntime();
  const colorScheme = useColorScheme();
  // Navigation prepares a request; only an explicit Send can start inference or consent.
  const conversation = (
    <ConversationScreen
      entryContext={{
        intent: intent ?? 'conversation',
        entryKey: navigationRouteKey ?? route,
        appointmentId: reminderRuntime?.homePreparationTargets.get(
          navigationRouteKey ?? '',
        ),
      }}
      providerSelection={providerSelection}
      navigationRouteKey={navigationRouteKey}
      onNavigationStateChange={onFeatureNavigationStateChange}
      onBack={onBack}
      onOpenHistory={onOpenConversationHistory}
      onSend={services.sendRagMessage}
      onOpenSource={onOpenSource}
      resolveToolSource={services.resolveToolSource}
      prepareVisitQuestions={
        services.prepareVisitQuestionTurn
          ? (question, _history, signal, observer, context) =>
              services.prepareVisitQuestionTurn!({
                question,
                context,
                signal: signal ?? new AbortController().signal,
                observer,
                resolveSelectedAi,
                confirmConsent,
              })
          : undefined
      }
      renderVisitQuestions={(message, sessionId, store, onRegenerate) => (
        <ConversationVisitQuestionCard
          message={message}
          sessionId={sessionId}
          store={store}
          operations={defaultVisitQuestionRouteOperations}
          services={services}
          onOpenSource={onOpenSource}
          theme={createNextVisitQuestionsTheme(colorScheme === 'dark')}
          onRegenerate={onRegenerate}
        />
      )}
    />
  );
  if (intent !== null) return conversation;

  switch (route) {
    case 'saved-visit-questions':
      return renderVisitQuestions
        ? renderVisitQuestions({
            readOnly: true,
            navigationRouteKey,
            onBack,
            onOpenProviderSelection,
            onOpenSource,
            onRouteStateChange,
            resolveSelectedAi,
            confirmConsent,
            resolveSource: services.resolveSource,
            generatedArtifactTools: services.generatedArtifactTools,
            registerVisitQuestionSource: services.registerVisitQuestionSource,
            selectedAiRevision,
            loadSavedVisitQuestions: services.loadSavedVisitQuestions,
          })
        : conversation;
    case 'saved-analysis':
      return (
        <DiseaseHypothesesScreen
          readOnly
          onOpenHistory={onOpenSummaryHistory}
          restoredSummary={restoredSummary}
          summaryHistory={services.summaryHistory}
          providerSelection={providerSelection}
          navigationRouteKey={navigationRouteKey}
          onNavigationStateChange={onFeatureNavigationStateChange}
          onBack={onBack}
          onGenerate={services.generateDiseaseHypotheses}
          onSummarize={services.summarizeSymptoms}
          onOpenProviderSelection={onOpenProviderSelection}
          onOpenSource={onOpenSource}
        />
      );
    case 'conversation-history':
      return (
        <ConversationHistoryScreen
          onBack={onBack}
          onOpenSavedAnalysis={onOpenSavedAnalysis}
          onOpenSavedVisitQuestions={onOpenSavedVisitQuestions}
        />
      );
    case 'summary-history':
      return services.summaryHistory && onRestoreSummary ? (
        <SummaryHistoryScreen
          history={services.summaryHistory}
          onRestore={onRestoreSummary}
        />
      ) : (
        conversation
      );
    default:
      return conversation;
  }
}
