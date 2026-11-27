import { ConversationVoiceEndMarker } from './ConversationVoiceEndMarker';
import { conversationVoiceEndPlacement } from './conversationVoiceEndPlacement';
import { ConversationActivityBubble } from './ConversationActivityBubble';
import { ConversationTranscriptEntranceScope } from './ConversationTranscriptEntranceScope';
import { conversationBubbleKey } from './conversationBubbleEntrances';
import { ConversationMessageReceipt } from './ConversationMessageReceipt';
import { Fragment, type ComponentProps, type ReactNode } from 'react';
import { View } from 'react-native';
import { styles } from './ConversationScreen.styles';
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
  voiceEndCards,
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
  readonly voiceEndCards?: ConversationHistoryProps['voiceEndCards'];
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
    'message' | 'copyScope' | 'verifiedA2UI' | 'coldPhotoSessionId'
  > & { readonly copyingAllowed?: boolean };
}) {
  const { copyingAllowed, ...renderMessage } = messageProps;
  const target =
    pendingId === undefined
      ? undefined
      : messages.find(message => message.id === pendingId);
  const firstLive = messages.findIndex(message => !message.restoredHistory);
  const placement = conversationVoiceEndPlacement(messages, voiceEndCards);
  const markerRows = (before: number | null, side: 'restored' | 'current') =>
    placement
      ?.get(before)
      ?.[side].map(card => (
        <ConversationVoiceEndMarker
          key={card.id}
          task={card.task}
          readObserved={card.observedQuote}
        />
      ));
  // Keep the same keyed choice block across first live append and older prepends.
  // Restored and current markers may share a slot, but not a side of the divider.
  const choices =
    entryChoices == null ? null : (
      <Fragment key="conversation-entry-choices">{entryChoices}</Fragment>
    );
  const rows: ReactNode[] = [];
  messages.forEach((message, position) => {
    rows.push(...(markerRows(message.id, 'restored') ?? []));
    if (choices && position === firstLive) rows.push(choices);
    rows.push(...(markerRows(message.id, 'current') ?? []));
    const ownInstructions =
      message === target ? instructions : message.steeringInstructions;
    const restored =
      message.id <= 0 || (message !== target && message.restoredHistory);
    const bubbleRows = (receipts: typeof instructions) =>
      receipts?.length ? (
        <ConversationSteeringMessages
          instructions={receipts}
          restored={restored}
        />
      ) : null;
    const reviewedOpening =
      message.initialResponse && message.initialResponse.source !== 'receipt';
    // A reviewed opening can be the entire predecessor; no superseded stream
    // text needs to exist before the applied instruction owns the successor.
    const afterBoundary =
      message.previousOutputs?.length || reviewedOpening
        ? (ownInstructions?.reduce(
            (index, row, current) =>
              row.status === 'applied' ? current + 1 : index,
            0,
          ) ?? 0)
        : 0;
    const before = message.streaming
      ? ownInstructions?.slice(0, afterBoundary)
      : ownInstructions;
    const after = message.streaming
      ? ownInstructions?.slice(afterBoundary)
      : undefined;
    const bubble = (
      <ConversationMessage
        message={message}
        copyScope={
          sessionId === undefined
            ? undefined
            : { sessionId, allowed: copyingAllowed === true }
        }
        beforeAnswer={bubbleRows(before)}
        {...renderMessage}
        coldPhotoSessionId={sessionId}
        verifiedA2UI={
          message.archivedA2UIPresentation
            ? {
                messageId: message.id,
                root: message.archivedA2UIPresentation,
                origin: 'owned-archive',
              }
            : message.a2uiPresentation
              ? { messageId: message.id, root: message.a2uiPresentation }
              : undefined
        }
      />
    );
    rows.push(
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
        {message.role === 'assistant' ? (
          <View
            style={styles.assistantBubbleSequence}
            testID="conversation-assistant-steering-sequence"
          >
            {bubble}
            {bubbleRows(after)}
          </View>
        ) : (
          <>
            {bubble}
            {bubbleRows(after)}
          </>
        )}
        {message.role === 'user' ? (
          <ConversationMessageReceipt
            delivery={message.delivery}
            pending={message.deliveryPending}
            localChoicePending={message.localChoicePending}
          />
        ) : null}
      </ReplyMessageContainer>,
    );
  });
  rows.push(...(markerRows(null, 'restored') ?? []));
  if (choices && firstLive < 0) rows.push(choices);
  rows.push(...(markerRows(null, 'current') ?? []));
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
      {!target && pendingId !== undefined ? (
        <ConversationSteeringMessages
          instructions={instructions}
          restored={pendingId <= 0}
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
