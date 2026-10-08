import type { ReactElement } from 'react';
import type {
  EvidenceItem,
  EvidenceReference,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { FeatureEntryScreen } from '../FeatureEntryScreen';
import { DiseaseHypothesesScreen } from '../../diseaseHypotheses/DiseaseHypothesesScreen';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { ExternalMedicalEvidenceScreen } from '../../externalMedicalEvidence/ExternalMedicalEvidenceScreen';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';
import type { AiFeatureServices } from './featureServices';
import type { SelectedAiResolution } from './provider';
import type { FeatureScreenRoute } from './aiFeatureNavigation';
import type { AiFeatureNavigationStateChange } from './useAiFeatureNavigationState';

export interface VisitQuestionsRenderInput {
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
  /** Generation is cancellable only after shared navigation confirms that this route may unmount. */
  readonly isGenerating: boolean;
  readonly revision: number;
}

export interface AiFeatureFlowScreenProps {
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
  onOpenSource,
  resolveSelectedAi,
  confirmConsent,
  selectedAiRevision,
  services,
  onOpenArticle,
}: AiFeatureFlowScreenProps) {
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
          navigationRouteKey={navigationRouteKey}
          onNavigationStateChange={onFeatureNavigationStateChange}
          onBack={onBack}
          onGenerate={services.generateDiseaseHypotheses}
          onOpenSource={onOpenSource}
        />
      );
    case 'rag-conversation':
      return (
        <ConversationScreen
          navigationRouteKey={navigationRouteKey}
          onNavigationStateChange={onFeatureNavigationStateChange}
          onBack={onBack}
          onSend={services.sendRagMessage}
          onOpenSource={onOpenSource}
        />
      );
    case 'external-evidence':
      return (
        <ExternalMedicalEvidenceScreen
          navigationRouteKey={navigationRouteKey}
          onNavigationStateChange={onFeatureNavigationStateChange}
          onBack={onBack}
          service={services.externalEvidence}
          onOpenArticle={onOpenArticle}
        />
      );
  }
}
