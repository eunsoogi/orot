import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { getAiFeatureCopy } from './copy';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useNavigationLeaveStateRegistration } from '../navigation';

export interface FeatureEntryScreenProps {
  readonly embedded?: boolean;
  readonly onOpenVisitQuestions?: () => void;
  readonly onOpenDiseaseHypotheses: () => void;
  readonly onOpenRagConversation: () => void;
  readonly onOpenExternalEvidence: () => void;
}

/** Keeps all four AI entry actions visible while preserving route and consent ownership. */
export function FeatureEntryScreen({
  embedded = false,
  onOpenVisitQuestions,
  onOpenDiseaseHypotheses,
  onOpenRagConversation,
  onOpenExternalEvidence,
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
  const splitIndex = Math.ceil(entries.length / 2);
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

  // Keep the action order stable while letting measured shell geometry and text scale choose the layout axis.
  const content = (
    <AdaptiveColumns
      primary={
        <View style={styles.panel}>
          <View style={styles.headingGroup}>
            <Text accessibilityRole="header" style={styles.heading}>
              {copy.heading}
            </Text>
            <Text style={styles.subtitle}>{copy.subtitle}</Text>
          </View>
          {renderEntries(entries.slice(0, splitIndex))}
        </View>
      }
      secondary={
        <View style={styles.panel}>
          {renderEntries(entries.slice(splitIndex))}
          <View style={styles.notice}>
            <AppSymbol name="info.circle" size={18} />
            <Text style={styles.disclaimer}>{copy.disclaimer}</Text>
          </View>
        </View>
      }
      testID="ai-feature-columns"
    />
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
    gap: 18,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 32,
    backgroundColor: appColors.background,
  },
  embedded: { alignSelf: 'stretch', gap: 18 },
  panel: { minWidth: 0, gap: 18 },
  headingGroup: { gap: 8 },
  heading: { color: appColors.text, fontSize: 36, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 16, lineHeight: 24 },
  list: {
    gap: 12,
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
