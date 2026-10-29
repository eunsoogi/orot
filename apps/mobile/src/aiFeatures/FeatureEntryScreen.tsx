import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { getAiFeatureCopy } from './copy';
import { hubSpacing } from '../layout/hubSpacing';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { healthReviewText } from '../i18n/healthReview';

export interface FeatureEntryScreenProps {
  readonly embedded?: boolean;
  readonly onOpenVisitQuestions?: () => void;
  readonly onOpenDiseaseHypotheses: () => void;
  readonly onOpenRagConversation: () => void;
  readonly onOpenExternalEvidence: () => void;
  readonly onOpenHealthReview?: () => void;
}

/** Keeps ordered AI entry actions in one readable page while preserving route and consent ownership. */
export function FeatureEntryScreen({
  embedded = false,
  onOpenVisitQuestions,
  onOpenDiseaseHypotheses,
  onOpenRagConversation,
  onOpenExternalEvidence,
  onOpenHealthReview,
}: FeatureEntryScreenProps) {
  const navigationInset = useNavigationContentInset();
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  const copy = getAiFeatureCopy();
  const actions = [
    onOpenVisitQuestions,
    onOpenDiseaseHypotheses,
    onOpenRagConversation,
    onOpenExternalEvidence,
  ];
  const symbols = [
    'bubble.left.and.text.bubble.right',
    'doc.text',
    'text.bubble',
    'book',
  ];

  const entries = copy.features.map((feature, index) => ({
    feature,
    action: actions[index],
    symbol: symbols[index],
  }));
  if (onOpenHealthReview)
    entries.push({
      feature: {
        id: 'health-review',
        title: healthReviewText.entry,
        description: '측정·증상 추이와 최근 기록을 함께 확인해요.',
        action: healthReviewText.entry,
      },
      action: onOpenHealthReview,
      symbol: 'heart.text.square',
    });
  const renderEntries = (group: typeof entries) => (
    <View style={styles.list}>
      {group.map(({ feature, action, symbol }) => (
        <View key={feature.id}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !action }}
            disabled={!action}
            onPress={action}
            style={styles.row}
            testID={`ai-feature-${feature.id}`}
          >
            <AppSymbol
              name={symbol ?? 'sparkle'}
              size={28}
              color={appColors.text}
            />
            <View style={styles.copy}>
              <Text style={styles.title}>{feature.title}</Text>
              <Text style={styles.description}>{feature.description}</Text>
            </View>
            <AppSymbol name="chevron.right" size={14} />
          </Pressable>
          {feature.id === 'visit-questions' && !action ? (
            <Text
              accessibilityRole="alert"
              style={styles.unavailable}
              testID="visit-questions-unavailable"
            >
              {copy.visitQuestionsUnavailable}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );

  // All entries share one list: splitting into padded panels adds a gap before the fourth action.
  const content = (
    <View style={styles.panel} testID="ai-feature-columns">
      <View style={styles.headingGroup}>
        <Text accessibilityRole="header" style={styles.heading}>
          {copy.heading}
        </Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
      </View>
      {renderEntries(entries)}
      <View style={styles.notice}>
        <AppSymbol name="info.circle" size={18} />
        <Text style={styles.disclaimer}>{copy.disclaimer}</Text>
      </View>
    </View>
  );

  if (embedded) {
    // An enclosing route owns scrolling, so embedded rows stay in the same scroll context.
    return (
      <View style={styles.embedded} testID="ai-features-screen">
        {content}
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.container, navigationInset]}
      testID="ai-features-screen"
    >
      {content}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    gap: hubSpacing.item,
    paddingHorizontal: hubSpacing.horizontal,
    paddingTop: hubSpacing.top,
    paddingBottom: hubSpacing.bottom,
    backgroundColor: appColors.background,
  },
  embedded: { alignSelf: 'stretch', gap: hubSpacing.item },
  panel: { minWidth: 0, gap: hubSpacing.item },
  headingGroup: { gap: 8 },
  heading: { color: appColors.text, fontSize: 36, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 16, lineHeight: 24 },
  list: {
    gap: hubSpacing.item,
  },
  row: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 14,
    minHeight: 80,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  copy: { flex: 1, gap: 4 },
  title: { color: appColors.text, fontSize: 16, fontWeight: '600' },
  description: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 10,
  },
  unavailable: { color: appColors.danger, padding: 14 },
  disclaimer: {
    flex: 1,
    color: appColors.secondary,
    fontSize: 13,
    lineHeight: 19,
  },
});
