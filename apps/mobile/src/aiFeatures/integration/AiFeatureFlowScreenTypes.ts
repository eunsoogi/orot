import type { ReactElement } from 'react';
import type {
  EvidenceItem,
  EvidenceReference,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import type { DiseaseHypothesisAnalysis } from '../../diseaseHypotheses/types';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';
import type { AiFeatureServices } from './featureServices';
import type { SelectedAiResolution } from './provider';
import type { FeatureScreenRoute } from './aiFeatureNavigation';
import type { AiFeatureNavigationStateChange } from './useAiFeatureNavigationState';
import type { ConversationEntryContext } from './conversationIntent';

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
  readonly isEntryCurrent?: () => boolean;
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
  readonly onOpenDailyReport?: () => void;
  readonly onOpenDailyReportChat?: (
    target: NonNullable<ConversationEntryContext['dailyReport']>,
  ) => void;
  readonly reportOwnsOperation?: boolean;
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
