import { AppText as Text } from '../layout/AppText';
import type { DisplayMessage } from './conversationDisplayMessage';
import { styles } from './ConversationScreen.styles';

/** Activity keeps its existing position and announcement mode as text streams. */
export function ConversationBubbleActivity({
  message,
}: {
  readonly message: DisplayMessage;
}) {
  return message.activity ? (
    <Text
      accessibilityLiveRegion={message.streaming ? 'none' : 'polite'}
      style={styles.activity}
      testID={
        message.streaming
          ? 'rag-conversation-progress'
          : message.incomplete
            ? 'rag-conversation-incomplete-activity'
            : undefined
      }
    >
      {message.activity}
    </Text>
  ) : null;
}
