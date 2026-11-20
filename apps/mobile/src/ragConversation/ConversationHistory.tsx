import RestoreIndicator from './ConversationRestoreIndicator';
import { conversationHistoryScrollEvents } from './conversationHistoryScrollEvents';
import { useConversationReadingPosition } from './useConversationReadingPosition';
import { useConversationTranscriptWindow } from './useConversationTranscriptWindow';
import { conversationHistoryError } from './conversationHistoryError';
import { useConversationJumpToLatest } from './useConversationJumpToLatest';
import { ConversationJumpToLatest } from './ConversationJumpToLatest';
import { useFloatingComposerInset } from './FloatingComposerSurface';
import { followConversationLatest } from './followConversationLatest';
import { useSeparatedConversationActivity } from './ConversationWorkspaceContext';
import { projectTranscript } from './conversationBubblePaint';
import { useFloatingIdentityInset } from '../assistantAppearance/FloatingIdentityInset';
import { useEffect, useRef, type ComponentRef } from 'react';
import { ScrollView, View } from 'react-native';
import { styles } from './ConversationScreen.styles';
import { ConversationTranscriptMessages } from './ConversationTranscriptMessages';
import { ConversationHistoryStatus } from './ConversationHistoryStatus';
import { useReplyScroll } from './useReplyScroll';
import { conversationHistoryActivity } from './conversationHistoryActivity';
import { useConversationHistoryUserTurnFollow } from './conversationHistoryUserTurn';
/** Owns transcript scrolling, restoration and reader-directed history loading. */
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
  restoring = false,
  restoringHistory = false,
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
}: import('./ConversationHistoryProps').ConversationHistoryProps) {
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
  const reading = useConversationReadingPosition({
    sessionId: toolSourceSessionId,
    messages: visibleMessages,
    blocked: restoring || restoreFailed,
    hasMore: historyHasMore,
    loading: historyLoading,
    failed: historyLoadFailed,
    focused: Boolean(replyFocus?.canReveal()),
    history: historyView,
    followsBottom,
    expectedOffset,
    geometry: scrollGeometry,
  });
  const transcript = projectTranscript(visibleMessages, separatedActivity);
  const window = useConversationTranscriptWindow({
    hasMore: historyHasMore,
    loading: historyLoading,
    failed: historyLoadFailed,
    loadOlder: onLoadOlderHistory,
    messages: transcript,
    sessionId,
    focusId: replyFocus?.canReveal() ? replyFocus.messageId : reading.targetId,
    focusGeneration: replyFocus?.generation,
    firstRowInset: styles.container.paddingTop,
    history: historyView,
    followsBottom,
    expectedOffset,
    geometry: scrollGeometry,
  });
  const followLatest = () =>
    !reading.pending &&
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
  const wasRestoringPosition = useRef(reading.pending);
  useEffect(() => {
    if (wasRestoringPosition.current && !reading.pending) followLatest();
    wasRestoringPosition.current = reading.pending;
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
        {...conversationHistoryScrollEvents({
          reading,
          viewportHeight,
          followLatest,
          jumpControl,
          window,
          userScrolling,
          expectedOffset,
          followsBottom,
        })}
        scrollEventThrottle={16}
        testID="rag-conversation-history"
      >
        {header}
        {beforeMessages}
        {window.control}
        <View
          style={styles.container}
          testID="conversation-message-container"
          onLayout={event => {
            replyScroll.container(event.nativeEvent.layout.y);
            reading.container(event.nativeEvent.layout.y);
          }}
        >
          <RestoreIndicator {...{ restoringHistory, restoreFailed }} />
          <ConversationTranscriptMessages
            onReadingLayout={reading.row}
            messages={window.messages}
            {...{ sessionId, availableMessages: visibleMessages }}
            showPendingBubble={showActivityBubble}
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
            reading.cancel();
            window.cancelAnchor();
            jumpControl.jump();
            reading.save({ bottom: true });
          }}
        />
      ) : null}
    </View>
  );
}
