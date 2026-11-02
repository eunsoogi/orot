import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { AppText } from '../layout/AppText';

/** Keeps manually entered history distinct while exposing it beside imported records. */
export function ManualHistoryAction({
  onPress,
  showDivider = false,
}: {
  readonly onPress: () => void;
  readonly showDivider?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.action, showDivider && styles.divider]}
      testID="records-open-manual-history"
    >
      <View style={styles.icon}>
        <AppSymbol name="text.book.closed" color={appColors.primaryAction} />
      </View>
      <View style={styles.copy}>
        <AppText style={styles.title}>{t('manualHistory.title')}</AppText>
        <AppText style={styles.subtitle}>{t('manualHistory.subtitle')}</AppText>
      </View>
      <AppSymbol name="chevron.right" size={16} color={appColors.secondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  action: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 70,
    minWidth: 0,
    paddingVertical: 9,
  },
  divider: {
    borderBottomColor: appColors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  title: { color: appColors.text, fontSize: 16, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 14, lineHeight: 19 },
});
