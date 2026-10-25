import { useRef } from 'react';
import type { ComponentRef, ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import type { EvidenceReference } from '@orot/agent-runtime';
import { styles } from './ConversationScreen.styles';
import { ConversationMessage } from './ConversationMessage';
import type { DisplayMessage } from './ConversationMessage';

/** Keeps the conversation history scrollable while the composer stays mounted. */
export function ConversationHistory({
  messages,
  pendingMessage,
  error,
  onOpenSource,
  onLinkError,
  bottomInset = 0,
  header,
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
}) {
  const historyView = useRef<ComponentRef<typeof ScrollView>>(null);
  // A single keyed list preserves the mounted answer across draft validation and cancellation.
  const visibleMessages: readonly DisplayMessage[] = pendingMessage
    ? [...messages, { ...pendingMessage, role: 'assistant', streaming: true }]
    : messages;

  return (
    <ScrollView
      ref={historyView}
      style={styles.history}
      contentContainerStyle={{ paddingBottom: bottomInset + 20 }}
      keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => {
        // Preserve the initial header position in empty conversations. Once an
        // answer exists, following its bottom must not leave a large fixed header
        // consuming the reading area at accessibility text sizes.
        if (visibleMessages.length)
          historyView.current?.scrollToEnd({ animated: true });
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
          />
        ))}
        {error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        ) : null}
      </View>
    </ScrollView>
  );
}
