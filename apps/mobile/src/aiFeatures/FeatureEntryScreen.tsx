import { Pressable, ScrollView, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { getAiFeatureCopy } from './copy';
import { appColors } from '../layout/appColors';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { useNavigationContentInset } from '../navigation/useNavigationContentInset';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { styles } from './FeatureEntryScreen.styles';

export interface FeatureEntryScreenProps {
  readonly embedded?: boolean;
  readonly onOpenVisitQuestions?: () => void;
  readonly onOpenDiseaseHypotheses: () => void;
  readonly onOpenRagConversation: () => void;
  readonly onOpenExternalEvidence: () => void;
  readonly onOpenHealthReview?: () => void;
}

type FeatureCopy = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly action: string;
};

type FeatureEntry = {
  readonly feature: FeatureCopy;
  readonly action?: () => void;
  readonly symbol: string;
  readonly iconColor: ColorValue;
};

const featureIcons: Record<string, { name: string; color: ColorValue }> = {
  'visit-questions': {
    name: 'questionmark.bubble',
    color: appColors.green,
  },
  'disease-hypotheses': { name: 'doc.text', color: appColors.purple },
  'rag-conversation': { name: 'text.bubble', color: appColors.primaryText },
  'health-review': { name: 'heart.text.square', color: appColors.pink },
  'external-evidence': { name: 'book', color: appColors.warning },
};

/** Prioritizes record conversation, then groups preparation and review while routes retain consent ownership. */
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
  const actionsById: Record<string, (() => void) | undefined> = {
    'visit-questions': onOpenVisitQuestions,
    'disease-hypotheses': onOpenDiseaseHypotheses,
    'rag-conversation': onOpenRagConversation,
    'health-review': onOpenHealthReview,
    'external-evidence': onOpenExternalEvidence,
  };
  const makeEntry = (feature: FeatureCopy): FeatureEntry => ({
    feature,
    action: actionsById[feature.id],
    symbol: featureIcons[feature.id]?.name ?? 'sparkle',
    iconColor: featureIcons[feature.id]?.color ?? appColors.secondary,
  });
  const conversation = makeEntry(copy.conversation);
  const preparationEntries = copy.preparation.features.map(makeEntry);
  const reviewEntries = copy.review.features
    .filter(feature => feature.id !== 'health-review' || onOpenHealthReview)
    .map(makeEntry);

  const renderEntries = (entries: readonly FeatureEntry[]) => (
    <View style={styles.list}>
      {entries.map(({ feature, action, symbol, iconColor }) => (
        <View key={feature.id}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: !action }}
            disabled={!action}
            onPress={action}
            style={styles.row}
            testID={`ai-feature-${feature.id}`}
          >
            <AppSymbol name={symbol} color={iconColor} />
            <View style={styles.copy}>
              <Text style={styles.title}>{feature.title}</Text>
              <Text style={styles.description}>{feature.description}</Text>
            </View>
            <AppSymbol name="chevron.right" color={appColors.secondary} />
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

  const renderGroup = (
    title: string,
    id: string,
    entries: readonly FeatureEntry[],
    separated = false,
  ) => (
    <View style={[styles.section, separated && styles.separatedSection]}>
      <Text
        accessibilityRole="header"
        style={styles.sectionHeading}
        testID={`ai-feature-group-${id}-heading`}
      >
        {title}
      </Text>
      {renderEntries(entries)}
    </View>
  );

  const content = (
    <View style={styles.panel} testID="ai-feature-columns">
      <View style={styles.headingGroup}>
        <Text accessibilityRole="header" style={styles.heading}>
          {copy.heading}
        </Text>
        <Text style={styles.subtitle}>{copy.subtitle}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !conversation.action }}
        disabled={!conversation.action}
        onPress={conversation.action}
        style={[styles.row, styles.conversationRow]}
        testID={`ai-feature-${conversation.feature.id}`}
      >
        {/* Keep the action outside this row so scaled copy can use the full card width. */}
        <View
          style={styles.conversationContent}
          testID="ai-feature-rag-conversation-content"
        >
          <AppSymbol
            name={conversation.symbol}
            color={conversation.iconColor}
          />
          <View style={styles.copy}>
            <Text style={styles.title}>{conversation.feature.title}</Text>
            <Text style={styles.description}>
              {conversation.feature.description}
            </Text>
          </View>
        </View>
        <View style={styles.conversationAction}>
          <Text style={styles.conversationActionText}>
            {conversation.feature.action}
          </Text>
          <AppSymbol name="arrow.right" color={appColors.primaryText} />
        </View>
      </Pressable>
      {renderGroup(copy.preparation.title, 'preparation', preparationEntries)}
      {renderGroup(copy.review.title, 'review', reviewEntries, true)}
      <View style={styles.notice}>
        <AppSymbol name="info.circle" size={18} color={appColors.secondary} />
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
