import { View, StyleSheet } from 'react-native';
import { ConversationBubbleEntrance } from './ConversationBubbleEntrance';
import { conversationBubbleKey } from './conversationBubbleEntrances';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';
import type { StoredSteeringInstruction } from '../storage/conversationSteeringStorage';

/** Local enqueue/write is not a receipt. Read means provider application, not claimed comprehension. */
export function ConversationSteeringMessages({
  instructions = [],
  restored,
}: {
  readonly instructions?: readonly StoredSteeringInstruction[];
  readonly restored?: boolean;
}) {
  return (
    <>
      {instructions.map(row => {
        const receipt =
          row.status === 'applied'
            ? t('conversationSteering.read')
            : row.status === 'not_applied'
              ? t('conversationSteering.not_applied')
              : row.serverAccepted
                ? t('conversationSteering.sent')
                : null;
        const observedAt =
          row.status === 'applied'
            ? row.readAt
            : row.status !== 'not_applied' && row.serverAccepted
              ? row.sentAt
              : undefined;
        const formatTime = (value?: string) =>
          value && Number.isFinite(Date.parse(value))
            ? new Intl.DateTimeFormat('ko-KR', {
                hour: 'numeric',
                minute: '2-digit',
              }).format(new Date(value))
            : undefined;
        const submittedTime = formatTime(row.submittedAt);
        const receiptTime = formatTime(observedAt);
        const receiptText = [
          submittedTime,
          receipt
            ? `${receipt}${receiptTime ? ` ${receiptTime}` : ''}`
            : undefined,
        ]
          .filter(Boolean)
          .join(' · ');
        return (
          <View
            key={row.id}
            style={receiptStyles.row}
            testID="conversation-steering-message"
          >
            <ConversationBubbleEntrance
              entranceKey={conversationBubbleKey('steering', row.id)}
              restored={restored}
              style={styles.userMessage}
            >
              <AppText selectable style={[styles.messageText, styles.userText]}>
                {row.text}
              </AppText>
            </ConversationBubbleEntrance>
            {receiptText ? (
              <AppText
                accessibilityLiveRegion="polite"
                accessibilityHint={
                  row.status === 'applied'
                    ? t('conversationSteering.readHint')
                    : undefined
                }
                style={receiptStyles.receipt}
              >
                {receiptText}
              </AppText>
            ) : null}
          </View>
        );
      })}
    </>
  );
}
const receiptStyles = StyleSheet.create({
  row: { alignSelf: 'stretch', gap: 4 },
  receipt: { alignSelf: 'flex-end', fontSize: 12 },
});
