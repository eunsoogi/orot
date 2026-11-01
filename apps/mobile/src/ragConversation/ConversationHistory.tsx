import { useRef } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import type { EvidenceReference } from '@orot/agent-runtime';
import { styles } from './ConversationScreen.styles';
import { ConversationMessage } from './ConversationMessage';
import type { DisplayMessage } from './ConversationMessage';

/** Owns the single scrollable conversation and evidence viewport. */
export function ConversationHistory({
  messages,
  pendingMessage,
  error,
  onOpenSource,
  onLinkError,
  bottomInset = 0,
  header,
  footer,
  compact = false,
  citationsInPanelForMessageId,
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
  readonly footer?: ReactNode;
  readonly compact?: boolean;
  readonly citationsInPanelForMessageId?: number;
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
  // A single keyed list preserves the mounted answer across draft validation and cancellation.
  const visibleMessages: readonly DisplayMessage[] = pendingMessage
    ? [...messages, { ...pendingMessage, role: 'assistant', streaming: true }]
    : messages;
  const followLatest = () => {
    if (!visibleMessages.length || !followsBottom.current) return;
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
        // Preserve the initial header position in empty conversations. Once an
        // answer exists, following its bottom must not leave a large fixed header
        // consuming the reading area at accessibility text sizes.
        followLatest();
      }}
      testID="rag-conversation-history"
    >
      {header}
      <View style={styles.container}>
        {!messages.length && (
          <View style={styles.empty}>
            <Text style={styles.disclaimer}>
              질문을 보내면 관련 기록과 원문 근거를 함께 찾아요.
            </Text>
            <Text style={styles.disclaimer}>
              필요하면 동의를 받고 공개 웹자료와 의학 문헌도 찾아요.
            </Text>
          </View>
        )}
        {visibleMessages.map(message => (
          <ConversationMessage
            key={message.id}
            message={message}
            onOpenSource={onOpenSource}
            onLinkError={onLinkError}
            compact={compact}
            // Keep one source action per latest answer; older answers retain inline citations.
            showCitations={message.id !== citationsInPanelForMessageId}
          />
        ))}
        {error ? (
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="rag-conversation-error"
          >
            {error}
          </Text>
        ) : null}
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
