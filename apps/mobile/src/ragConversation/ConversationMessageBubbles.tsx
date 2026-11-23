import { useConversationFinalCommitDiagnostic } from './conversationFinalCommitDiagnostic';
import { ConversationPreviousOutputs } from './ConversationPreviousOutputs';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { ConversationBubbleEntrance } from './ConversationBubbleEntrance';
import {
  conversationBubblePaint,
  type ConversationBubblePresentation,
} from './conversationBubblePaint';
import { conversationBubbleKey } from './conversationBubbleEntrances';
import { ConversationInitialResponse } from './ConversationInitialResponse';
import type { ConversationBubbleCopy } from './ConversationBubbleCopyHost';
import type { DisplayMessage } from './conversationDisplayMessage';
import { styles } from './ConversationScreen.styles';

/** Split presentation only: both bubbles keep one protected turn identity and focus target.
 * No synthetic timestamp, history entry, model call or persisted record is introduced. */
export function ConversationMessageBubbles({
  message,
  children,
  beforeAnswer,
  openingCopyMenu,
  presentation,
}: {
  readonly message: DisplayMessage;
  readonly children: ReactNode;
  readonly beforeAnswer?: ReactNode;
  readonly openingCopyMenu?: ConversationBubbleCopy;
  readonly presentation: ConversationBubblePresentation;
}) {
  const { opening, showBody } = conversationBubblePaint(message, presentation);
  useConversationFinalCommitDiagnostic(message, Boolean(showBody));
  if (!opening && !beforeAnswer) return showBody ? children : null;
  return (
    <View style={styles.assistantBubbleSequence}>
      {opening ? (
        <ConversationBubbleEntrance
          entranceKey={conversationBubbleKey('opening', message.id)}
          restored={message.restoredHistory || message.id <= 0}
          copyMenu={openingCopyMenu}
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
      ) : null}
      {beforeAnswer && message.previousOutputs?.length ? (
        <View style={styles.assistantMessage}>
          <ConversationPreviousOutputs outputs={message.previousOutputs} />
        </View>
      ) : null}
      {beforeAnswer}
      {showBody ? children : null}
    </View>
  );
}
