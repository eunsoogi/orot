import { View } from 'react-native';
import { AppText } from '../layout/AppText';
import type { DisplayMessage } from './conversationDisplayMessage';
import { ConversationInitialResponse } from './ConversationInitialResponse';
import { styles } from './ConversationScreen.styles';

/** A prior owner's plain projection deliberately has no citation, links,
 * menus, disclosure, or retry action to hand to the current conversation. */
export function ConversationPreviousArchiveMessage({
  message,
}: {
  readonly message: DisplayMessage;
}) {
  if (message.role === 'user')
    return (
      <View style={styles.userMessage}>
        <AppText style={[styles.messageText, styles.userText]}>
          {message.content}
        </AppText>
      </View>
    );
  return (
    <>
      {message.initialResponse ? (
        <View style={styles.assistantMessage}>
          <ConversationInitialResponse response={message.initialResponse} />
        </View>
      ) : null}
      <View style={styles.assistantMessage}>
        <AppText style={styles.messageText}>{message.content}</AppText>
      </View>
    </>
  );
}
