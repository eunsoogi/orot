import { Pressable, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { ComposerGlassBackground } from './ComposerGlassBackground';
import { styles } from './ConversationScreen.styles';

/** Keep the title and conversation controls together for the adaptive header. */
export function ConversationHeaderTitle({
  title,
  historyLabel,
  newLabel,
  showActions,
  onHistory,
  onNew,
}: {
  title: string;
  historyLabel: string;
  newLabel: string;
  showActions: boolean;
  onHistory?: () => void;
  onNew: () => void;
}) {
  return (
    <View style={styles.titleRow}>
      <Text accessibilityRole="header" style={styles.heading}>
        {title}
      </Text>
      {showActions ? (
        <View style={styles.sessionActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={historyLabel}
            disabled={!onHistory}
            onPress={onHistory}
            style={[styles.sessionAction, !onHistory && styles.disabled]}
            testID="rag-conversation-sessions-toggle"
          >
            <ComposerGlassBackground testID="rag-conversation-history-glass" />
            <AppSymbol
              name="clock.arrow.circlepath"
              color={appColors.primaryText}
            />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={newLabel}
            onPress={onNew}
            style={styles.sessionAction}
            testID="rag-conversation-new-session"
          >
            <ComposerGlassBackground testID="rag-conversation-new-glass" />
            <AppSymbol name="plus" color={appColors.primaryText} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
