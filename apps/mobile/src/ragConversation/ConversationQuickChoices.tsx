import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { CONVERSATION_SECTION_GAP } from './ConversationScreen.styles';

export const ConversationChoiceBoundary = createContext(false);

/** Mark only the actual restored boundary; fresh choices keep their plain rule. */
export function ConversationQuickChoices({
  children,
}: {
  children: ReactNode;
}) {
  const restored = useContext(ConversationChoiceBoundary);
  return (
    <View
      style={[styles.choices, !restored && styles.freshChoices]}
      testID="conversation-quick-choices"
    >
      <View
        testID="conversation-choices-divider"
        style={styles.divider}
        accessible={false}
        pointerEvents="none"
      >
        <View style={styles.rule} accessibilityElementsHidden />
        {restored ? (
          <>
            <AppText accessibilityRole="header" style={styles.label}>
              {t('ragConversation.history.previousConversation')}
            </AppText>
            <View style={styles.rule} accessibilityElementsHidden />
          </>
        ) : null}
      </View>
      {children}
    </View>
  );
}
const styles = StyleSheet.create({
  choices: { gap: 12 },
  freshChoices: { paddingVertical: CONVERSATION_SECTION_GAP },
  divider: {
    marginBottom: CONVERSATION_SECTION_GAP - 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rule: { flex: 1, height: 1, backgroundColor: appColors.border },
  label: {
    flexShrink: 1,
    maxWidth: '80%',
    color: appColors.secondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
