import { StyleSheet, View } from 'react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { ConversationMessage } from './ConversationMessage';
import type { DisplayMessage } from './ConversationMessage';
import type { ConversationSession } from './conversationSessions';
import { t } from '../i18n';

const ignoreSource = (_reference: EvidenceReference) => undefined;
const ignoreLinkError = () => undefined;

/** Reads the selected in-memory thread without resolving source records or exposing another send action. */
export function ConversationHistoryPreview({
  session,
}: {
  readonly session: ConversationSession | null;
}) {
  const visibleMessages: readonly DisplayMessage[] = session?.pendingMessage
    ? [
        ...session.messages,
        { ...session.pendingMessage, role: 'assistant', streaming: true },
      ]
    : (session?.messages ?? []);

  return (
    <View style={styles.preview} testID="conversation-history-preview">
      <Text
        accessibilityRole="header"
        style={styles.title}
        testID="conversation-history-preview-title"
      >
        {session?.title ?? t('ragConversation.history.previewTitle')}
      </Text>
      <View
        style={styles.messages}
        testID="conversation-history-preview-messages"
      >
        {visibleMessages.length > 0 ? (
          visibleMessages.map(message => (
            <ConversationMessage
              key={message.id}
              message={message}
              onOpenSource={ignoreSource}
              onLinkError={ignoreLinkError}
              showCitations={false}
            />
          ))
        ) : (
          <Text
            style={styles.empty}
            testID="conversation-history-preview-empty"
          >
            {t('ragConversation.history.previewEmpty')}
          </Text>
        )}
        {session?.error ? (
          <Text
            accessibilityRole="alert"
            style={styles.error}
            testID="conversation-history-preview-error"
          >
            {session.error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    gap: 12,
    padding: 20,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: appColors.border,
    backgroundColor: appColors.surface,
  },
  title: { color: appColors.text, fontSize: 20, fontWeight: '700' },
  messages: { gap: 16, paddingBottom: 16 },
  empty: { color: appColors.secondary, fontSize: 15, lineHeight: 22 },
  error: { color: appColors.danger },
});
