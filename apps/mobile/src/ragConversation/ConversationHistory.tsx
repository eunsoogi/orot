import { useRef } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { styles } from './ConversationScreen.styles';
import { ConversationMessage } from './ConversationMessage';
import type { DisplayMessage } from './ConversationMessage';
import type { ResolveConversationToolSource } from './ConversationToolEventSources';
import { ConversationHistoryStatus } from './ConversationHistoryStatus';
import { useReplyScroll } from './useReplyScroll';
import { ReplyMessageContainer } from './ReplyMessageContainer';
import type { ReplyFocusHandle } from '../replyNotifications/replyFocus';

/** Owns the scrollable transcript and keeps visit targets before messages in visual and source order. */
export function ConversationHistory({
  messages,
  pendingMessage,
  error,
  onOpenSource,
  onLinkError,
  bottomInset = 0,
  header,
  beforeMessages,
  footer,
  compact = false,
  unsavedCount = 0,
  retryingSave = false,
  onRetrySave,
  restoreFailed = false,
  onRetryRestore,
  toolSourceSessionId,
  resolveToolSource,
  renderVisitQuestions,
  replyFocus,
}: {
  readonly messages: readonly DisplayMessage[];
  readonly pendingMessage: {
    id: number;
    content: string;
    activity: string;
  } | null;
  readonly error: string;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
  readonly bottomInset?: number;
  readonly header?: ReactNode;
  readonly beforeMessages?: ReactNode;
  readonly footer?: ReactNode;
  readonly compact?: boolean;
  readonly unsavedCount?: number;
  readonly retryingSave?: boolean;
  readonly onRetrySave?: () => void;
  readonly restoreFailed?: boolean;
  readonly onRetryRestore?: () => void;
  readonly toolSourceSessionId?: string | null;
  readonly resolveToolSource?: ResolveConversationToolSource;
  readonly renderVisitQuestions?: (message: DisplayMessage) => ReactNode;
  readonly replyFocus?: ReplyFocusHandle;
}) {
  const historyView = useRef<ComponentRef<typeof ScrollView>>(null);
  const followsBottom = useRef(true);
  const userScrolling = useRef(false);
  const viewportHeight = useRef(0);
  const messageEnd = useRef<number | null>(null);
  const scrollGeometry = useRef<{
    height: number;
    contentHeight: number;
    offset: number;
  } | null>(null);
  const expectedOffset = useRef<number | null>(null);
  const replyScroll = useReplyScroll({
    history: historyView,
    focus: replyFocus,
    followsBottom,
    expectedOffset,
  });
  // A single keyed list preserves the mounted answer across draft validation and cancellation.
  const visibleMessages: readonly DisplayMessage[] = pendingMessage
    ? [...messages, { ...pendingMessage, role: 'assistant', streaming: true }]
    : messages;
  const followLatest = () => {
    if (!visibleMessages.length || !followsBottom.current || replyFocus) return;
    if (compact) {
      if (messageEnd.current !== null && viewportHeight.current > 0) {
        expectedOffset.current = Math.max(
          0,
          messageEnd.current - viewportHeight.current,
        );
        historyView.current?.scrollTo({
          y: expectedOffset.current,
          animated: false,
        });
      }
    } else {
      const geometry = scrollGeometry.current;
      expectedOffset.current = geometry
        ? Math.max(0, geometry.contentHeight - geometry.height)
        : null;
      historyView.current?.scrollToEnd({ animated: false });
    }
  };

  return (
    <ScrollView
      ref={historyView}
      style={styles.history}
      contentContainerStyle={{
        paddingBottom: bottomInset + (compact ? 0 : 20),
      }}
      keyboardShouldPersistTaps="handled"
      onLayout={({ nativeEvent }) => {
        viewportHeight.current = nativeEvent.layout.height;
        followLatest();
      }}
      onScrollBeginDrag={() => {
        userScrolling.current = true;
        expectedOffset.current = null;
      }}
      onScrollEndDrag={() => {
        userScrolling.current = false;
      }}
      onMomentumScrollBegin={() => {
        userScrolling.current = true;
      }}
      onMomentumScrollEnd={() => {
        userScrolling.current = false;
      }}
      onScroll={({ nativeEvent }) => {
        const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
        const previous = scrollGeometry.current;
        const changed =
          previous !== null &&
          (previous.height !== layoutMeasurement.height ||
            previous.contentHeight !== contentSize.height);
        scrollGeometry.current = {
          height: layoutMeasurement.height,
          contentHeight: contentSize.height,
          offset: contentOffset.y,
        };
        if (previous && Math.abs(contentOffset.y - previous.offset) < 1) return;
        // Geometry changes and our own offset corrections do not imply reader intent.
        if (changed && !userScrolling.current) {
          expectedOffset.current = null;
          const maximum = Math.max(
            0,
            contentSize.height - layoutMeasurement.height,
          );
          const clampedPrevious = Math.min(
            Math.max(0, previous.offset),
            maximum,
          );
          if (
            Math.abs(contentOffset.y - clampedPrevious) < 1 ||
            (followsBottom.current &&
              previous.height !== layoutMeasurement.height &&
              Math.abs(
                previous.offset -
                  Math.max(0, previous.contentHeight - previous.height),
              ) < 1 &&
              Math.abs(contentOffset.y - maximum) < 1)
          )
            return;
        }
        const expected = expectedOffset.current;
        expectedOffset.current = null;
        if (
          !userScrolling.current &&
          expected !== null &&
          Math.abs(
            Math.min(
              expected,
              Math.max(0, contentSize.height - layoutMeasurement.height),
            ) - contentOffset.y,
          ) < 1
        )
          return;
        // Only follow streamed content while the reader remains near the bottom.
        followsBottom.current =
          compact && messageEnd.current !== null
            ? Math.abs(
                Math.max(0, messageEnd.current - layoutMeasurement.height) -
                  contentOffset.y,
              ) < 48
            : contentSize.height - contentOffset.y - layoutMeasurement.height <
              48;
      }}
      onScrollToTop={() => {
        expectedOffset.current = null;
        followsBottom.current = false;
      }}
      scrollEventThrottle={16}
      onContentSizeChange={() => {
        // Keep the compact header available before a conversation has a message.
        // After an answer arrives, following its end keeps the reading viewport useful.
        followLatest();
      }}
      testID="rag-conversation-history"
    >
      {header}
      {beforeMessages}
      <View
        style={styles.container}
        testID="conversation-message-container"
        onLayout={event => replyScroll.container(event.nativeEvent.layout.y)}
      >
        {visibleMessages.map(message => (
          <ReplyMessageContainer
            key={`${message.id}:${replyFocus && message.retainedTurnId === replyFocus.messageId ? `focus-${replyFocus.generation}` : 'ordinary'}`}
            focused={Boolean(
              replyFocus && message.retainedTurnId === replyFocus.messageId,
            )}
            onLayout={replyScroll.message}
          >
            <ConversationMessage
              message={message}
              onOpenSource={onOpenSource}
              onLinkError={onLinkError}
              compact={compact}
              toolSourceSessionId={toolSourceSessionId}
              resolveToolSource={resolveToolSource}
              renderVisitQuestions={renderVisitQuestions}
            />
          </ReplyMessageContainer>
        ))}
        <ConversationHistoryStatus
          {...{
            error,
            unsavedCount,
            retryingSave,
            onRetrySave,
            restoreFailed,
            onRetryRestore,
          }}
        />
      </View>
      {/* The footer stays in place while compact follow targets the end of messages. */}
      <View
        collapsable={false}
        onLayout={event => {
          messageEnd.current = event.nativeEvent.layout.y;
          if (compact) followLatest();
        }}
        testID="rag-conversation-message-end"
      />
      {footer}
    </ScrollView>
  );
}
