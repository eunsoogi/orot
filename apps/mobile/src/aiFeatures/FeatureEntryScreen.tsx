import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getAiFeatureCopy } from './copy';

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
  container: { gap: 12, padding: 20 },
  embedded: { alignSelf: 'stretch', gap: 12 },
  heading: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  card: {
    borderColor: '#C9D4D1',
    borderRadius: 14,
    borderWidth: 1,
    gap: 8,
    padding: 16,
  },
  title: { fontSize: 17, fontWeight: '700' },
  description: { color: '#45524F', fontSize: 14, lineHeight: 20 },
  action: { alignSelf: 'flex-start', paddingVertical: 8 },
  actionText: { color: '#174F45', fontSize: 15, fontWeight: '700' },
});
