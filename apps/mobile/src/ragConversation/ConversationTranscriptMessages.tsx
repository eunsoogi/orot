import type { ComponentProps } from 'react';
import {
  ConversationMessage,
  type DisplayMessage,
} from './ConversationMessage';
import { ReplyMessageContainer } from './ReplyMessageContainer';
import { ConversationSteeringMessages } from './ConversationSteeringMessages';
import type { ConversationHistoryProps } from './ConversationHistoryProps';

/** Receipts belong to their response, never to whichever turn happens to be last later. */
export function ConversationTranscriptMessages({
  messages,
  pendingId,
  instructions,
  replyFocus,
  onLayout,
  messageProps,
}: {
  readonly messages: readonly DisplayMessage[];
  readonly pendingId?: number;
  readonly instructions: ConversationHistoryProps['steeringInstructions'];
  readonly replyFocus: ConversationHistoryProps['replyFocus'];
  readonly onLayout: ComponentProps<typeof ReplyMessageContainer>['onLayout'];
  readonly messageProps: Omit<
    ComponentProps<typeof ConversationMessage>,
    'message'
  >;
}) {
  const target =
    pendingId === undefined
      ? undefined
      : messages.find(message => message.id === pendingId);
  return (
    <>
      {messages.map(message => (
        <ReplyMessageContainer
          key={`${message.id}:${replyFocus && message.retainedTurnId === replyFocus.messageId ? `focus-${replyFocus.generation}` : 'ordinary'}`}
          focused={Boolean(
            replyFocus && message.retainedTurnId === replyFocus.messageId,
          )}
          onLayout={onLayout}
        >
          <ConversationSteeringMessages
            instructions={
              message === target ? instructions : message.steeringInstructions
            }
          />
          <ConversationMessage message={message} {...messageProps} />
        </ReplyMessageContainer>
      ))}
      {!target ? (
        <ConversationSteeringMessages instructions={instructions} />
      ) : null}
    </>
  );
}
