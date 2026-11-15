import { View } from 'react-native';
import { GlassIconButton } from '../layout/GlassIconButton';
import { styles } from './ConversationScreen.styles';

/** Retain standalone session controls without a redundant title or empty header row. */
export function ConversationHeaderActions({
  historyLabel,
  newLabel,
  showActions,
  onHistory,
  onNew,
}: {
  historyLabel: string;
  newLabel: string;
  showActions: boolean;
  onHistory?: () => void;
  onNew: () => void;
}) {
  if (!showActions) return null;
  return (
    <View style={styles.sessionActions} testID="conversation-header-actions">
      <GlassIconButton
        accessibilityRole="button"
        accessibilityLabel={historyLabel}
        disabled={!onHistory}
        onPress={onHistory}
        style={styles.sessionAction}
        testID="rag-conversation-sessions-toggle"
        symbolName="clock.arrow.circlepath"
      />
      <GlassIconButton
        accessibilityRole="button"
        accessibilityLabel={newLabel}
        onPress={onNew}
        style={styles.sessionAction}
        testID="rag-conversation-new-session"
        symbolName="plus"
      />
    </View>
  );
}
