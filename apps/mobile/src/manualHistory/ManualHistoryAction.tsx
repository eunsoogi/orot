import { Pressable, StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { AppText } from '../layout/AppText';

/** Keeps manually entered history distinct while exposing it beside imported records. */
export function ManualHistoryAction({
  onPress,
}: {
  readonly onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.action}
      testID="records-open-manual-history"
    >
      <View style={styles.icon}>
        <AppSymbol
          name="text.book.closed"
          size={28}
          color={appColors.primaryAction}
        />
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
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 16,
    minHeight: 88,
    paddingHorizontal: 18,
  },
  icon: {
    alignItems: 'center',
    backgroundColor: appColors.primarySoft,
    borderRadius: 14,
    height: 48,
    justifyContent: 'center',
    width: 48,
  },
  copy: { flex: 1, gap: 4 },
  title: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  subtitle: { color: appColors.secondary, fontSize: 14, lineHeight: 20 },
});
