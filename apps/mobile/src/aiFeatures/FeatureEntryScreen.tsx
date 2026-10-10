import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { getAiFeatureCopy } from './copy';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';

export interface FeatureEntryScreenProps {
  readonly embedded?: boolean;
  readonly onOpenVisitQuestions?: () => void;
  readonly onOpenDiseaseHypotheses: () => void;
  readonly onOpenRagConversation: () => void;
  readonly onOpenExternalEvidence: () => void;
}

/** Keeps feature routing at the app boundary and disables entries without an owned screen. */
export function FeatureEntryScreen({
  embedded = false,
  onOpenVisitQuestions,
  onOpenDiseaseHypotheses,
  onOpenRagConversation,
  onOpenExternalEvidence,
}: FeatureEntryScreenProps) {
  const copy = getAiFeatureCopy();
  const actions = [
    onOpenVisitQuestions,
    onOpenDiseaseHypotheses,
    onOpenRagConversation,
    onOpenExternalEvidence,
  ];

  const content = (
    <>
      <Text accessibilityRole="header" style={styles.heading}>
        {copy.heading}
      </Text>
      {copy.features.map((feature, index) => (
        <View key={feature.id} style={styles.card}>
          <Text accessibilityRole="header" style={styles.title}>
            {feature.title}
          </Text>
          <Text style={styles.description}>{feature.description}</Text>
          {feature.id === 'visit-questions' && !actions[index] ? (
            <Text
              accessibilityRole="alert"
              style={styles.unavailable}
              testID="visit-questions-unavailable"
            >
              {copy.visitQuestionsUnavailable}
            </Text>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !actions[index] }}
            disabled={!actions[index]}
            onPress={actions[index]}
            style={styles.action}
            testID={`ai-feature-${feature.id}`}
          >
            <Text style={styles.actionText}>{feature.action}</Text>
          </Pressable>
        </View>
      ))}
    </>
  );

  if (embedded) {
    // The home route owns scrolling, so embedded cards avoid a nested scroll view.
    return (
      <View style={styles.embedded} testID="ai-features-screen">
        {content}
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.container}
      testID="ai-features-screen"
    >
      {content}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { gap: 12, padding: 20, backgroundColor: appColors.background },
  embedded: { alignSelf: 'stretch', gap: 12 },
  heading: {
    color: appColors.text,
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 24,
    gap: 10,
    padding: 22,
  },
  title: { color: appColors.text, fontSize: 20, fontWeight: '700' },
  description: { color: appColors.secondary, fontSize: 15, lineHeight: 23 },
  unavailable: { color: appColors.danger },
  action: {
    backgroundColor: appColors.primarySoft,
    borderRadius: 14,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginTop: 4,
  },
  actionText: { color: appColors.primaryText, fontSize: 16, fontWeight: '600' },
});
