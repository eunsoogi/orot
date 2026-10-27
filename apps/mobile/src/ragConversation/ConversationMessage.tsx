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
            testID={message.streaming ? 'rag-conversation-stream' : undefined}
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
