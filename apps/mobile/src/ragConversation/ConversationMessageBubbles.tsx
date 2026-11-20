import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ConversationBubbleEntrance } from './ConversationBubbleEntrance';
import {
  conversationBubblePaint,
  type ConversationBubblePresentation,
} from './conversationBubblePaint';
import { conversationBubbleKey } from './conversationBubbleEntrances';
import { ConversationInitialResponse } from './ConversationInitialResponse';
import type { DisplayMessage } from './conversationDisplayMessage';
import { styles } from './ConversationScreen.styles';

/** Split presentation only: both bubbles keep one protected turn identity and focus target.
 * No synthetic timestamp, history entry, model call or persisted record is introduced. */
export function ConversationMessageBubbles({
  message,
  children,
  presentation,
}: {
  readonly message: DisplayMessage;
  readonly children: ReactNode;
  readonly presentation: ConversationBubblePresentation;
}) {
  const { opening, showBody } = conversationBubblePaint(message, presentation);
  if (!opening) return showBody ? children : null;
  return (
    <View style={styles.assistantBubbleSequence}>
      <ConversationBubbleEntrance
        entranceKey={conversationBubbleKey('opening', message.id)}
        restored={message.restoredHistory || message.id <= 0}
        testID="conversation-assistant-opening-message"
        style={styles.assistantMessage}
      >
        <View testID="conversation-opening-body" style={styles.assistantBody}>
          <ConversationInitialResponse
            key={opening.callId}
            response={opening}
          />
        </View>
      </ConversationBubbleEntrance>
      {showBody ? children : null}
    </View>
  );
}
