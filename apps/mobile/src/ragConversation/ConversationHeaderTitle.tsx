import { View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { GlassIconButton } from '../layout/GlassIconButton';
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
    <>
      <View style={styles.titleRow}>
        <Text accessibilityRole="header" style={styles.heading}>
          {title}
        </Text>
        {showActions ? (
          <View style={styles.sessionActions}>
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
        ) : null}
      </View>
    </>
  );
}
