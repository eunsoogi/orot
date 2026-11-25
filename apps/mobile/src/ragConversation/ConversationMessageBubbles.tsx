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
import {
  ConversationBubbleCopyHost,
  type ConversationBubbleCopy,
} from './ConversationBubbleCopyHost';
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
          testID="conversation-assistant-opening-message"
          style={styles.assistantMessage}
        >
          <ConversationBubbleBody opening copyMenu={openingCopyMenu}>
            <ConversationInitialResponse
              key={opening.callId}
              response={opening}
              allowLiveLayout={message.streaming && !message.restoredHistory}
            />
          </ConversationBubbleBody>
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

/** The native paint host has no inset: Fabric would apply it again to its Paper view. */
export function ConversationBubbleBody({
  user,
  opening,
  compactStreaming,
  copyMenu,
  children,
}: {
  readonly user?: boolean;
  readonly opening?: boolean;
  readonly compactStreaming?: boolean;
  readonly copyMenu?: ConversationBubbleCopy;
  readonly children: ReactNode;
}) {
  if (user)
    return (
      <View testID="conversation-message-body" style={styles.userMessageBody}>
        {children}
      </View>
    );
  const testID = opening
    ? 'conversation-opening-body'
    : 'conversation-message-body';
  const contentStyle = [
    styles.assistantBodyContent,
    compactStreaming && styles.compactStreamingBody,
  ];
  if (!copyMenu || !ConversationBubbleCopyHost)
    return (
      <View testID={testID} style={[styles.assistantBody, ...contentStyle]}>
        {children}
      </View>
    );
  return (
    <ConversationBubbleCopyHost
      testID={testID}
      style={styles.assistantBody}
      {...copyMenu}
    >
      <View style={contentStyle}>{children}</View>
    </ConversationBubbleCopyHost>
  );
}
