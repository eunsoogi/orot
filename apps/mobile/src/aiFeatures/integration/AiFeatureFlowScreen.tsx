import { AiProviderSelectorRow } from './AiProviderSelectorRow';
import { SummaryHistoryScreen } from '../../diseaseHypotheses/SummaryHistoryScreen';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';
import type { ReactElement } from 'react';
import type {
  EvidenceItem,
  EvidenceReference,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { FeatureEntryScreen } from '../FeatureEntryScreen';
import { DiseaseHypothesesScreen } from '../../diseaseHypotheses/DiseaseHypothesesScreen';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { ConversationHistoryScreen } from '../../ragConversation/ConversationHistoryScreen';
import { ExternalMedicalEvidenceScreen } from '../../externalMedicalEvidence/ExternalMedicalEvidenceScreen';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';
import type { AiFeatureServices } from './featureServices';
import type { SelectedAiResolution } from './provider';
import type { FeatureScreenRoute } from './aiFeatureNavigation';
import type { AiFeatureNavigationStateChange } from './useAiFeatureNavigationState';

export interface VisitQuestionsRenderInput {
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
  onOpenSummaryHistory,
  onRestoreSummary,
  restoredSummary,
  route,
  navigationRouteKey,
  onFeatureNavigationStateChange,
  renderVisitQuestions,
  onRouteStateChange,
  onBack,
  onOpenVisitQuestions,
  onOpenDiseaseHypotheses,
  onOpenRagConversation,
  onOpenExternalEvidence,
  onOpenProviderSelection,
  onOpenConversationHistory,
  onOpenSource,
  resolveSelectedAi,
  confirmConsent,
  selectedAiRevision,
  services,
  onOpenArticle,
}: AiFeatureFlowScreenProps) {
  const providerSelection = (
    <AiProviderSelectorRow
      embedded
      onPress={onOpenProviderSelection}
      resolveSelectedAi={resolveSelectedAi}
      revision={selectedAiRevision}
    />
  );
  const entryScreen = (
    <FeatureEntryScreen
      onOpenVisitQuestions={onOpenVisitQuestions}
      onOpenDiseaseHypotheses={onOpenDiseaseHypotheses}
      onOpenRagConversation={onOpenRagConversation}
      onOpenExternalEvidence={onOpenExternalEvidence}
    />
  );

  switch (route) {
    case 'entry':
      return entryScreen;
    case 'visit-questions':
      return renderVisitQuestions
        ? renderVisitQuestions({
            navigationRouteKey,
            onBack,
            onOpenProviderSelection,
            onOpenSource,
            onRouteStateChange,
            resolveSelectedAi,
            confirmConsent,
            resolveSource: services.resolveSource,
            registerVisitQuestionSource: services.registerVisitQuestionSource,
            selectedAiRevision,
            loadSavedVisitQuestions: services.loadSavedVisitQuestions,
          })
        : entryScreen;
    case 'disease-hypotheses':
      return (
        <DiseaseHypothesesScreen
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
    case 'rag-conversation':
      return (
        <ConversationScreen
          providerSelection={providerSelection}
          navigationRouteKey={navigationRouteKey}
          onNavigationStateChange={onFeatureNavigationStateChange}
          onBack={onBack}
          onOpenHistory={onOpenConversationHistory}
          onSend={services.sendRagMessage}
          onOpenSource={onOpenSource}
        />
      );
    case 'conversation-history':
      return <ConversationHistoryScreen onBack={onBack} />;
    case 'summary-history':
      return services.summaryHistory && onRestoreSummary ? (
        <SummaryHistoryScreen
          history={services.summaryHistory}
          onRestore={onRestoreSummary}
        />
      ) : (
        entryScreen
      );
    case 'external-evidence':
      return (
        <ExternalMedicalEvidenceScreen
          providerSelection={providerSelection}
          navigationRouteKey={navigationRouteKey}
          onNavigationStateChange={onFeatureNavigationStateChange}
          onBack={onBack}
          service={services.externalEvidence}
          onOpenArticle={onOpenArticle}
        />
      );
  }
}
