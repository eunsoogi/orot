import { StyleSheet } from 'react-native';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import {
  parseConversationMessageDelivery,
  type ConversationMessageDelivery,
} from './conversationMessageDelivery';

/** Show local submission time separately from observed receipt times; no time-based success inference. */
export function ConversationMessageReceipt({
  delivery,
  pending = false,
}: {
  readonly delivery?: ConversationMessageDelivery;
  readonly pending?: boolean;
}) {
  const value = parseConversationMessageDelivery(delivery);
  if (!value) return null;
  const format = (at: string) =>
    new Intl.DateTimeFormat('ko-KR', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(at));
  const label = value.readAt
    ? t('conversationDelivery.read')
    : value.acceptedAt
      ? t('conversationDelivery.sent')
      : pending
        ? t('conversationDelivery.sending')
        : '';
  const observed = value.readAt ?? value.acceptedAt;
  const submission = format(value.submittedAt);
  return (
    <AppText
      testID="conversation-message-receipt"
      style={styles.receipt}
      accessibilityLiveRegion="polite"
      accessibilityLabel={`${t('conversationDelivery.submitted')} ${new Date(value.submittedAt).toLocaleString('ko-KR')}${label ? ` · ${label}${observed ? ` ${new Date(observed).toLocaleString('ko-KR')}` : ''}` : ''}`}
      accessibilityHint={
        value.readAt ? t('conversationDelivery.readMeaning') : undefined
      }
    >
      {submission}
      {label
        ? ` · ${label}${observed && format(observed) !== submission ? ` ${format(observed)}` : ''}`
        : ''}
    </AppText>
  );
}
const styles = StyleSheet.create({
  receipt: { alignSelf: 'flex-end', fontSize: 12, marginTop: 4 },
});
