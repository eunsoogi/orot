import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { appColors } from '../layout/appColors';

/** Keep explicit task choices after the transcript without changing answer typography. */
export function ConversationQuickChoices({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <View style={styles.choices} testID="conversation-quick-choices">
      <View style={styles.divider} accessible={false} />
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  choices: { gap: 12 },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: appColors.border,
  },
});
