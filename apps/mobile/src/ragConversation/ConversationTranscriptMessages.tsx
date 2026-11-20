import { ConversationActivityBubble } from './ConversationActivityBubble';
import { ConversationTranscriptEntranceScope } from './ConversationTranscriptEntranceScope';
import { conversationBubbleKey } from './conversationBubbleEntrances';
import { ConversationMessageReceipt } from './ConversationMessageReceipt';
import { Fragment, type ComponentProps, type ReactNode } from 'react';
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
  availableMessages = messages,
  sessionId,
  showPendingBubble,
  entryChoices,
  pendingId,
  instructions,
  replyFocus,
  onLayout,
  messageProps,
  anchorId,
  onAnchorLayout,
  onReadingLayout,
}: {
  readonly onReadingLayout?: (id: number, y: number, height: number) => void;
  readonly entryChoices?: ReactNode;
  readonly messages: readonly DisplayMessage[];
  readonly availableMessages?: readonly DisplayMessage[];
  readonly sessionId?: number;
  readonly showPendingBubble?: boolean;
  readonly anchorId?: number;
  readonly onAnchorLayout?: (y: number) => void;
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
  const firstLive = messages.findIndex(message => !message.restoredHistory);
  const rows = messages.map(message => (
    <ReplyMessageContainer
      key={`${message.id}:${replyFocus && message.retainedTurnId === replyFocus.messageId ? `focus-${replyFocus.generation}` : 'ordinary'}`}
      readingId={onReadingLayout ? message.id : undefined}
      focused={Boolean(
        replyFocus && message.retainedTurnId === replyFocus.messageId,
      )}
      onLayout={onLayout}
      onFrame={
        onReadingLayout
          ? (y, height) => onReadingLayout(message.id, y, height)
          : undefined
      }
      onPosition={message.id === anchorId ? onAnchorLayout : undefined}
    >
      <ConversationSteeringMessages
        restored={
          message.id <= 0 || (message !== target && message.restoredHistory)
        }
        instructions={
          message === target ? instructions : message.steeringInstructions
        }
      />
      <ConversationMessage message={message} {...messageProps} />
      {message.role === 'user' ? (
        <ConversationMessageReceipt
          delivery={message.delivery}
          pending={message.deliveryPending}
        />
      ) : null}
    </ReplyMessageContainer>
  ));
  // A stable sibling key preserves choice/task state across the first live append and older prepends.
  // Fragments add no layout wrapper, preserving reply-focus and paging row coordinates.
  if (entryChoices != null)
    rows.splice(
      firstLive < 0 ? rows.length : firstLive,
      0,
      <Fragment key="conversation-entry-choices">{entryChoices}</Fragment>,
    );
  return (
    <ConversationTranscriptEntranceScope
      availableMessages={availableMessages}
      instructions={instructions}
      pendingId={pendingId}
      showPendingBubble={showPendingBubble}
      presentation={messageProps}
      sessionId={sessionId}
    >
      {rows}
      {!target ? (
        <ConversationSteeringMessages
          instructions={instructions}
          restored={pendingId === undefined || pendingId <= 0}
        />
      ) : null}
      {showPendingBubble ? (
        <ConversationActivityBubble
          entranceKey={
            pendingId === undefined || pendingId <= 0
              ? undefined
              : conversationBubbleKey('pending', pendingId)
          }
        />
      ) : null}
    </ConversationTranscriptEntranceScope>
  );
}
