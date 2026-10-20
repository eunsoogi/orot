import { View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText as Text } from '../layout/AppText';
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
}: {
  readonly message: DisplayMessage;
  readonly onOpenSource: (reference: EvidenceReference) => void;
  readonly onLinkError: () => void;
}) {
  const user = message.role === 'user';
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
          <Text
            selectable
            style={[styles.messageText, user && styles.userText]}
            testID={message.streaming ? 'rag-conversation-stream' : undefined}
          >
            {message.content}
          </Text>
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
        <ConversationSources
          references={message.citations ?? []}
          onOpenSource={onOpenSource}
          onLinkError={onLinkError}
        />
      </View>
    </View>
  );
}
