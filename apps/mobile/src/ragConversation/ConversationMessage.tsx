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
  /** Failed prompts stay visible when the user has already drafted a different question. */
  readonly failed?: boolean;
}

/** Citation labels reveal source type and date; opaque record aliases remain implementation details. */
export function ConversationMessage({
  message,
  onOpenSource,
  onLinkError,
  showCitations = true,
}: {
  readonly message: DisplayMessage;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
  readonly showCitations?: boolean;
}) {
  const user = message.role === 'user';
  const MessageText = user ? Text : AiResponseText;
  // Native production verification needs a stable target for completed text, apart from citation controls.
  const messageTextTestID = message.streaming
    ? 'rag-conversation-stream'
    : user
      ? undefined
      : 'rag-conversation-answer-body';
  return (
    <View style={user ? styles.userMessage : styles.assistantMessage}>
      <View style={!user && styles.assistantBody}>
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
        {message.content ? (
          <MessageText
            selectable
            style={[styles.messageText, user && styles.userText]}
            testID={messageTextTestID}
          >
            {message.content}
          </MessageText>
        ) : null}
        {message.activity ? (
          <Text
            accessibilityLiveRegion="polite"
            style={styles.activity}
            testID={message.streaming ? 'rag-conversation-progress' : undefined}
          >
            {message.activity}
          </Text>
        ) : null}
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
