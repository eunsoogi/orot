import { View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText as Text } from '../layout/AppText';
import { AiResponseText } from '../layout/AiResponseText';
import { ConversationSources } from './ConversationSources';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';
import type { RagConversationMessage } from './task';

export interface DisplayMessage extends RagConversationMessage {
  readonly id: number;
  readonly citations?: readonly EvidenceReference[];
  readonly activity?: string;
  readonly streaming?: boolean;
  readonly incomplete?: boolean;
  readonly completion?: 'complete' | 'partial';
  readonly toolMessageId?: string;
  readonly toolEvents?: readonly import('@orot/agent-runtime').ConversationToolEvent[];
  /** Failed prompts stay visible when the user has already drafted a different question. */
  readonly failed?: boolean;
}

/** Keeps transcript citations beside their answer; compact session previews may omit source links. */
export function ConversationMessage({
  message,
  onOpenSource,
  onLinkError,
  showCitations = true,
  compact = false,
}: {
  readonly message: DisplayMessage;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
  readonly showCitations?: boolean;
  readonly compact?: boolean;
}) {
  const user = message.role === 'user';
  const MessageText = user ? Text : AiResponseText;
  // Native production verification needs a stable target for completed text, apart from citation controls.
  const messageTextTestID = message.streaming
    ? 'rag-conversation-stream'
    : user
      ? undefined
      : message.incomplete
        ? 'rag-conversation-incomplete-body'
        : 'rag-conversation-answer-body';
  const activity = message.activity ? (
    <Text
      accessibilityLiveRegion="polite"
      style={styles.activity}
      testID={
        message.streaming
          ? 'rag-conversation-progress'
          : message.incomplete
            ? 'rag-conversation-incomplete-activity'
            : undefined
      }
    >
      {message.activity}
    </Text>
  ) : null;
  // Keep the last streamed line at the end of a short reading viewport.
  const activityBeforeText = compact && message.streaming;
  return (
    <View style={user ? styles.userMessage : styles.assistantMessage}>
      <View
        style={
          !user && [
            styles.assistantBody,
            activityBeforeText && styles.compactStreamingBody,
          ]
        }
      >
        {message.incomplete && message.content ? (
          <>
            <Text style={styles.activity}>
              {t('aiActivity.draft.incompleteHeading')}
            </Text>
            <Text style={styles.activity}>
              {t('aiActivity.draft.incompleteNote')}
            </Text>
          </>
        ) : null}
        {message.completion === 'partial' ? (
          <Text style={styles.activity}>
            {t('ragConversation.savedPartial')}
          </Text>
        ) : null}
        {activityBeforeText ? activity : null}
        {message.content ? (
          <MessageText
            selectable
            style={[styles.messageText, user && styles.userText]}
            testID={messageTextTestID}
          >
            {message.content}
          </MessageText>
        ) : null}
        {!activityBeforeText ? activity : null}
        {showCitations ? (
          <ConversationSources
            references={message.citations ?? []}
            onOpenSource={onOpenSource}
            onLinkError={onLinkError}
          />
        ) : null}
      </View>
    </View>
  );
}
