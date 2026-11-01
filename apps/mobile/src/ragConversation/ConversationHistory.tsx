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
  const viewportHeight = useRef(0);
  const messageEnd = useRef<number | null>(null);
  // A single keyed list preserves the mounted answer across draft validation and cancellation.
  const visibleMessages: readonly DisplayMessage[] = pendingMessage
    ? [...messages, { ...pendingMessage, role: 'assistant', streaming: true }]
    : messages;
  const followLatest = () => {
    if (!visibleMessages.length || !followsBottom.current) return;
    if (compact) {
      if (messageEnd.current !== null && viewportHeight.current > 0)
        historyView.current?.scrollTo({
          y: Math.max(0, messageEnd.current - viewportHeight.current),
          animated: false,
        });
    } else historyView.current?.scrollToEnd({ animated: true });
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
      onScroll={({ nativeEvent }) => {
        const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
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
