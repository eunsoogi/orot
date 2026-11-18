import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { appColors } from '../layout/appColors';

/** Keep explicit task choices at the restored-history boundary without changing answer typography. */
export function ConversationQuickChoices({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <View style={styles.choices} testID="conversation-quick-choices">
      <View
        testID="conversation-choices-divider"
        style={styles.divider}
        accessible={false}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  choices: { gap: 12, paddingVertical: 20 },
  divider: {
    marginBottom: 8,
    // This marks the restored-history boundary, not a decorative card edge.
    // Match the wide conversation pane and composer divider through the shared token.
    height: 1,
    flexShrink: 0,
    alignSelf: 'stretch',
    backgroundColor: appColors.border,
  },
});
