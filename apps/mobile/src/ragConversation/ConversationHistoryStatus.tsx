import { AppText as Text } from '../layout/AppText';
import { AppButton as Button } from '../layout/AppButton';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';

/** Show recovery actions only for the corresponding retained state. */
export function ConversationHistoryStatus({
  error,
  unsavedCount,
  retryingSave,
  onRetrySave,
  restoreFailed,
  onRetryRestore,
}: {
  error: string;
  unsavedCount: number;
  retryingSave: boolean;
  onRetrySave?: () => void;
  restoreFailed: boolean;
  onRetryRestore?: () => void;
}) {
  return (
    <>
      {error ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="rag-conversation-error"
        >
          {error}
        </Text>
      ) : null}
      {unsavedCount > 0 && onRetrySave ? (
        <Button
          title={t('ragConversation.conversation.retrySave')}
          onPress={onRetrySave}
          disabled={retryingSave}
        />
      ) : null}
      {restoreFailed && onRetryRestore ? (
        <Button
          title={t('ragConversation.history.retryRestore')}
          onPress={onRetryRestore}
        />
      ) : null}
    </>
  );
}
