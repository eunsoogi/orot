import { DesignButton, DesignCard, DesignScreen, DesignText } from '../design';
import { getAiFeatureCopy } from './copy';

export interface FeatureEntryScreenProps {
  readonly onOpenVisitQuestions: () => void;
  readonly onOpenDiseaseHypotheses: () => void;
  readonly onOpenRagConversation: () => void;
  readonly onOpenExternalEvidence: () => void;
}

/** Groups each task's explanation and action while routing stays with the app owner. */
export function FeatureEntryScreen(props: FeatureEntryScreenProps) {
  const copy = getAiFeatureCopy();
  const actions = [
    props.onOpenVisitQuestions,
    props.onOpenDiseaseHypotheses,
    props.onOpenRagConversation,
    props.onOpenExternalEvidence,
  ];

  return (
    <DesignScreen title={copy.heading} testID="ai-features-screen">
      {copy.features.map((feature, index) => (
        <DesignCard key={feature.id}>
          <DesignText accessibilityRole="header" variant="heading">
            {feature.title}
          </DesignText>
          <DesignText tone="secondary">{feature.description}</DesignText>
          <DesignButton
            label={feature.action}
            onPress={actions[index]}
            testID={`ai-feature-${feature.id}`}
            variant="secondary"
          />
        </DesignCard>
      ))}
    </DesignScreen>
  );
}
