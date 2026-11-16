import { View, StyleSheet } from 'react-native';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { styles } from './ConversationScreen.styles';
import type { StoredSteeringInstruction } from '../storage/conversationSteeringStorage';

/** Local enqueue/write is not a receipt. Read means provider application, not claimed comprehension. */
export function ConversationSteeringMessages({
  instructions = [],
}: {
  readonly instructions?: readonly StoredSteeringInstruction[];
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
        return (
          <View
            key={row.id}
            style={receiptStyles.row}
            testID="conversation-steering-message"
          >
            <View style={styles.userMessage}>
              <AppText selectable style={[styles.messageText, styles.userText]}>
                {row.text}
              </AppText>
            </View>
            {receipt ? (
              <AppText
                accessibilityLiveRegion="polite"
                style={receiptStyles.receipt}
              >
                {receipt}
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
