import { useConversationTranscriptWindow } from './useConversationTranscriptWindow';
import { conversationHistoryError } from './conversationHistoryError';
import { useConversationJumpToLatest } from './useConversationJumpToLatest';
import { ConversationJumpToLatest } from './ConversationJumpToLatest';
import { useFloatingComposerInset } from './FloatingComposerSurface';
import { followConversationLatest } from './followConversationLatest';
import { useSeparatedConversationActivity } from './ConversationWorkspaceContext';
import { transcriptMessageVisible } from './conversationWorkspaceLayout';
import { useFloatingIdentityInset } from '../assistantAppearance/FloatingIdentityInset';
import { useRef, type ComponentRef } from 'react';
import { ScrollView, View } from 'react-native';
import { styles } from './ConversationScreen.styles';
import { ConversationTranscriptMessages } from './ConversationTranscriptMessages';
import { ConversationHistoryStatus } from './ConversationHistoryStatus';
import { useReplyScroll } from './useReplyScroll';
import { ConversationActivityBubble } from './ConversationActivityBubble';
import { conversationHistoryActivity } from './conversationHistoryActivity';
import type { ConversationHistoryProps } from './ConversationHistoryProps';
import { useConversationHistoryUserTurnFollow } from './conversationHistoryUserTurn';
/** Owns the scrollable transcript and keeps visit targets before messages in visual and source order. */
export function ConversationHistory({
  messages,
  steeringInstructions,
  pendingMessage,
  error,
  onOpenSource,
  onContinueCold,
  coldResumeBusy,
  onLinkError,
  bottomInset = 0,
  header,
  beforeMessages,
  footer,
  entryChoices,
  compact = false,
  unsavedCount = 0,
  retryingSave = false,
  onRetrySave,
  restoreFailed = false,
  onRetryRestore,
  sessionId,
  historyHasMore,
  historyLoading,
  historyLoadFailed,
  onLoadOlderHistory,
  toolSourceSessionId,
  resolveToolSource,
  resolveColdToolSource,
  renderVisitQuestions,
  replyFocus,
  requestSessionId,
  requestActivity,
}: ConversationHistoryProps) {
  const identityInset = useFloatingIdentityInset();
  const composerInset = useFloatingComposerInset();
  const separatedActivity = useSeparatedConversationActivity();
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
  const jumpControl = useConversationJumpToLatest({
    sessionId,
    replyFocusGeneration: replyFocus?.generation,
    compact,
    composerInset,
    messageEnd,
    followsBottom,
    userScrolling,
    expectedOffset,
    scrollGeometry,
    historyView,
  });
  const replyScroll = useReplyScroll({
    history: historyView,
    focus: replyFocus,
    followsBottom,
    expectedOffset,
  });
  const { visibleMessages, showActivityBubble } = conversationHistoryActivity(
    messages,
    pendingMessage,
    requestSessionId,
    requestActivity,
    separatedActivity,
  );
  useConversationHistoryUserTurnFollow(
    sessionId ?? null,
    messages,
    followsBottom,
    expectedOffset,
  );
  const window = useConversationTranscriptWindow({
    hasMore: historyHasMore,
    loading: historyLoading,
    failed: historyLoadFailed,
    loadOlder: onLoadOlderHistory,
    messages: visibleMessages.filter(message =>
      transcriptMessageVisible(message, separatedActivity),
    ),
    sessionId,
    focusId: replyFocus?.canReveal() ? replyFocus.messageId : undefined,
    focusGeneration: replyFocus?.generation,
    firstRowInset: styles.container.paddingTop,
    history: historyView,
    followsBottom,
    expectedOffset,
    geometry: scrollGeometry,
  });
  const followLatest = () =>
    followConversationLatest({
      hasMessages: visibleMessages.length > 0,
      compact,
      focused: Boolean(replyFocus),
      followsBottom,
      messageEnd,
      viewportHeight,
      bottomInset: composerInset,
      expectedOffset,
      historyView,
      scrollGeometry,
    });
  return (
    <View style={styles.history}>
      <ScrollView
        ref={historyView}
        style={styles.history}
        contentContainerStyle={{
          paddingTop: identityInset,
          paddingBottom: bottomInset + composerInset + (compact ? 0 : 20),
        }}
        keyboardShouldPersistTaps="handled"
        onLayout={({ nativeEvent }) => {
          viewportHeight.current = nativeEvent.layout.height;
          jumpControl.refresh({ height: nativeEvent.layout.height });
          followLatest();
        }}
        onScrollBeginDrag={() => {
          jumpControl.cancelJump();
          window.cancelAnchor();
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
        onScroll={event => {
          jumpControl.onScroll(event);
          window.onTopEdge(
            event.nativeEvent.contentOffset.y,
            userScrolling.current,
          );
        }}
        onScrollToTop={() => {
          jumpControl.cancelJump();
          expectedOffset.current = null;
          followsBottom.current = false;
        }}
        scrollEventThrottle={16}
        onContentSizeChange={(_width, height) => {
          jumpControl.refresh({
            height: viewportHeight.current,
            contentHeight: height,
          });
          followLatest();
        }}
        testID="rag-conversation-history"
      >
        {header}
        {beforeMessages}
        {window.control}
        <View
          style={styles.container}
          testID="conversation-message-container"
          onLayout={event => replyScroll.container(event.nativeEvent.layout.y)}
        >
          <ConversationTranscriptMessages
            messages={window.messages}
            entryChoices={entryChoices}
            anchorId={window.anchorId}
            onAnchorLayout={window.onAnchorLayout}
            pendingId={pendingMessage?.id}
            instructions={steeringInstructions}
            replyFocus={replyFocus}
            onLayout={replyScroll.message}
            messageProps={{
              onContinueCold,
              coldResumeBusy,
              resolveColdToolSource,
              showToolActivity: false,
              onOpenSource,
              onLinkError,
              compact,
              toolSourceSessionId,
              resolveToolSource,
              renderVisitQuestions,
            }}
          />
          {showActivityBubble ? <ConversationActivityBubble /> : null}
          <ConversationHistoryStatus
            error={conversationHistoryError(
              error,
              visibleMessages,
              separatedActivity,
            )}
            {...{
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
            jumpControl.refresh();
            if (compact) followLatest();
          }}
          testID="rag-conversation-message-end"
        />
        {footer}
      </ScrollView>
      {jumpControl.away ? (
        <ConversationJumpToLatest
          bottom={composerInset}
          onPress={() => {
            window.cancelAnchor();
            jumpControl.jump();
          }}
        />
      ) : null}
    </View>
  );
}
