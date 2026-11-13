import { Pressable, StyleSheet, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { ComposerGlassBackground } from './ComposerGlassBackground';
import { t } from '../i18n';

interface SavedOutputAction {
  readonly title: string;
  readonly description: string;
  readonly onPress: () => void;
  readonly testID: string;
}

/** Keeps the page hierarchy and saved browsing actions inside the history page's single scroll. */
export function ConversationHistoryHeader({
  conversationCount,
  onCreateSession,
  onOpenSavedAnalysis,
  onOpenSavedVisitQuestions,
  showNewSession,
}: {
  readonly conversationCount: number;
  readonly onCreateSession: () => void;
  readonly onOpenSavedAnalysis?: () => void;
  readonly onOpenSavedVisitQuestions?: () => void;
  readonly showNewSession: boolean;
}) {
  const savedOutputs: SavedOutputAction[] = [];
  if (onOpenSavedAnalysis) {
    savedOutputs.push({
      title: t('ragConversation.history.savedAnalysis'),
      description: t('ragConversation.history.savedAnalysisDescription'),
      onPress: onOpenSavedAnalysis,
      testID: 'conversation-saved-analysis',
    });
  }
  if (onOpenSavedVisitQuestions) {
    savedOutputs.push({
      title: t('ragConversation.history.savedVisitQuestions'),
      description: t('ragConversation.history.savedVisitQuestionsDescription'),
      onPress: onOpenSavedVisitQuestions,
      testID: 'conversation-saved-visit-questions',
    });
  }

  return (
    <View style={styles.header} testID="conversation-history-header">
      <View style={styles.titleRow} testID="conversation-history-title-row">
        <Text
          accessibilityRole="header"
          style={styles.heading}
          testID="conversation-history-title"
        >
          {t('ragConversation.history.title')}
        </Text>
        {showNewSession ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('ragConversation.history.newConversation')}
            style={styles.newButton}
            onPress={onCreateSession}
            testID="conversation-history-new"
          >
            <ComposerGlassBackground />
            <AppSymbol name="plus" color={appColors.primaryText} />
          </Pressable>
        ) : null}
      </View>
      <Text style={styles.count} testID="conversation-history-count">
        {t('ragConversation.history.count', { count: conversationCount })}
      </Text>
      {savedOutputs.length > 0 ? (
        <View
          style={styles.savedOutputs}
          testID="conversation-history-saved-outputs"
        >
          <Text
            accessibilityRole="header"
            style={styles.savedOutputsTitle}
            testID="conversation-history-saved-outputs-title"
          >
            {t('ragConversation.history.savedOutputsTitle')}
          </Text>
          {savedOutputs.map(output => (
            <Pressable
              key={output.testID}
              accessibilityRole="button"
              accessibilityLabel={`${output.title}, ${output.description}`}
              accessibilityHint={t(
                'ragConversation.history.savedOutputOpenHint',
              )}
              style={({ pressed }) => [
                styles.savedOutput,
                pressed && styles.savedOutputPressed,
              ]}
              onPress={output.onPress}
              testID={output.testID}
            >
              <View style={styles.savedOutputText}>
                <Text style={styles.savedOutputTitle}>{output.title}</Text>
                <Text style={styles.savedOutputDescription}>
                  {output.description}
                </Text>
              </View>
              <AppSymbol name="chevron.right" color={appColors.secondary} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 8,
    gap: 8,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heading: { flex: 1, minWidth: 0, fontSize: 34, fontWeight: '700' },
  count: { color: appColors.secondary, fontSize: 14 },
  newButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedOutputs: { marginTop: 8, gap: 8 },
  savedOutputsTitle: { fontSize: 17, fontWeight: '600' },
  savedOutput: {
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  savedOutputPressed: { opacity: 0.76 },
  savedOutputText: { flex: 1, minWidth: 0, gap: 4 },
  savedOutputTitle: { fontSize: 16, fontWeight: '600' },
  savedOutputDescription: { color: appColors.secondary, fontSize: 14 },
});
