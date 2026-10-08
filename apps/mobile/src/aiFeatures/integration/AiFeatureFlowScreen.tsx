import type { ReactElement } from 'react';
import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import { FeatureEntryScreen } from '../FeatureEntryScreen';
import { DiseaseHypothesesScreen } from '../../diseaseHypotheses/DiseaseHypothesesScreen';
import { ConversationScreen } from '../../ragConversation/ConversationScreen';
import { ExternalMedicalEvidenceScreen } from '../../externalMedicalEvidence/ExternalMedicalEvidenceScreen';
import type { ExternalMedicalPublication } from '../../externalMedicalEvidence/europePmc';
import type { AiFeatureServices } from './featureServices';
import type { SelectedAiResolution } from './provider';
import type { FeatureScreenRoute } from './aiFeatureNavigation';

export interface VisitQuestionsRenderInput {
  readonly onBack: () => void;
  readonly onOpenProviderSelection: () => void;
  readonly onOpenSource: (reference: EvidenceItem) => void;
  readonly resolveSelectedAi: () => Promise<SelectedAiResolution>;
  readonly selectedAiRevision: number;
  readonly loadSavedVisitQuestions: AiFeatureServices['loadSavedVisitQuestions'];
}

export interface AiFeatureFlowScreenProps {
  readonly route: FeatureScreenRoute;
  readonly renderVisitQuestions?: (
    input: VisitQuestionsRenderInput,
  ) => ReactElement;
  readonly onBack: () => void;
  readonly onOpenVisitQuestions?: () => void;
  readonly onOpenDiseaseHypotheses: () => void;
  readonly onOpenRagConversation: () => void;
  readonly onOpenExternalEvidence: () => void;
  readonly onOpenProviderSelection: () => void;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly resolveSelectedAi: () => Promise<SelectedAiResolution>;
  readonly selectedAiRevision: number;
  readonly services: AiFeatureServices;
  readonly onOpenArticle: (publication: ExternalMedicalPublication) => void;
}

/** Renders one stack destination while the parent keeps source/provider overlays mounted above it. */
export function AiFeatureFlowScreen({
  route,
  renderVisitQuestions,
  onBack,
  onOpenVisitQuestions,
  onOpenDiseaseHypotheses,
  onOpenRagConversation,
  onOpenExternalEvidence,
  onOpenProviderSelection,
  onOpenSource,
  resolveSelectedAi,
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
            resolveSelectedAi,
            selectedAiRevision,
            loadSavedVisitQuestions: services.loadSavedVisitQuestions,
          })
        : entryScreen;
    case 'disease-hypotheses':
      return (
        <DiseaseHypothesesScreen
          onBack={onBack}
          onGenerate={services.generateDiseaseHypotheses}
          onOpenSource={onOpenSource}
        />
      );
    case 'rag-conversation':
      return (
        <ConversationScreen
          onBack={onBack}
          onSend={services.sendRagMessage}
          onOpenSource={onOpenSource}
        />
      );
    case 'external-evidence':
      return (
        <ExternalMedicalEvidenceScreen
          onBack={onBack}
          service={services.externalEvidence}
          onOpenArticle={onOpenArticle}
        />
      );
  }
}
