import { Pressable, StyleSheet, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';

type SettingsRowTone = 'blue' | 'green' | 'pink' | 'purple' | 'neutral';

interface SettingsRouteRowProps {
  readonly onPress: () => void;
  readonly summary?: string;
  readonly testID: string;
  readonly title: string;
  readonly symbol: string;
  readonly tone?: SettingsRowTone;
}

/** Keeps each Settings destination as the same accessible, appearance-aware action. */
export function SettingsRouteRow({
  onPress,
  summary,
  testID,
  title,
  symbol,
  tone = 'blue',
}: SettingsRouteRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={styles.row}
      testID={testID}
    >
      <View style={[styles.icon, { backgroundColor: tones[tone].background }]}>
        <AppSymbol name={symbol} size={24} color={tones[tone].foreground} />
      </View>
      <View style={styles.rowCopy}>
        <Text style={styles.rowTitle}>{title}</Text>
        {summary ? <Text style={styles.summary}>{summary}</Text> : null}
      </View>
      <AppSymbol name="chevron.right" size={14} />
    </Pressable>
  );
}

/** Shows the native app version with the same grouped row treatment as before. */
export function SettingsRouteAppInfo({
  version,
}: {
  readonly version?: string;
}) {
  return (
    <View style={styles.row} testID="settings-app-info">
      <AppSymbol name="info.circle" size={24} color={appColors.text} />
      <Text style={styles.rowTitle}>
        {t('app.welcome.title')}
        {version ? ` ${version}` : ''}
      </Text>
    </View>
  );
}

// Semantic icon colors follow system appearance, including the tinted backgrounds.
const tones: Record<
  SettingsRowTone,
  { foreground: ColorValue; background: ColorValue }
> = {
  blue: {
    foreground: appColors.primaryText,
    background: appColors.primarySoft,
  },
  green: { foreground: appColors.green, background: appColors.greenSoft },
  pink: { foreground: appColors.pink, background: appColors.pinkSoft },
  purple: { foreground: appColors.purple, background: appColors.purpleSoft },
  neutral: {
    foreground: appColors.secondary,
    background: appColors.background,
  },
};

const styles = StyleSheet.create({
  icon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    alignItems: 'center',
    backgroundColor: appColors.surface,
    flexDirection: 'row',
    gap: 16,
    minHeight: 60,
    paddingHorizontal: 16,
  },
  rowCopy: { flex: 1, gap: 4, paddingVertical: 10 },
  rowTitle: { color: appColors.text, fontSize: 16, fontWeight: '500' },
  summary: { color: appColors.secondary, fontSize: 13 },
});
