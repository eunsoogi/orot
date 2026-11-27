import { Pressable, StyleSheet, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { AppText as Text } from '../layout/AppText';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import { settingsListColors } from './settingsListColors';

type SettingsRowTone = 'blue' | 'green' | 'pink' | 'purple' | 'neutral';

interface SettingsRouteRowProps {
  readonly onPress: () => void;
  readonly testID: string;
  readonly title: string;
  readonly symbol: string;
  readonly tone?: SettingsRowTone;
}

/** Keeps each Settings destination as the same accessible, appearance-aware action. */
export function SettingsRouteRow({
  onPress,
  testID,
  title,
  symbol,
  tone = 'blue',
}: SettingsRouteRowProps) {
  return (
    <Pressable
      accessibilityLabel={title}
      accessibilityRole="button"
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <SettingsRouteIcon symbol={symbol} tone={tone} />
      <View style={styles.rowContent}>
        <Text style={styles.rowTitle}>{title}</Text>
        <AppSymbol name="chevron.right" size={12} color={appColors.secondary} />
      </View>
    </Pressable>
  );
}

/** Shows the native app version with the same compact row geometry as its neighboring destinations. */
export function SettingsRouteAppInfo({
  version,
}: {
  readonly version?: string;
}) {
  return (
    <View style={styles.row} testID="settings-app-info">
      <SettingsRouteIcon
        symbol="info.circle"
        testID="settings-app-info-icon"
        tone="blue"
      />
      {/* Give native tests the version text itself, independent of matching labels elsewhere. */}
      <Text style={styles.rowTitle} testID="settings-app-info-text">
        {t('app.welcome.title')}
        {version ? ` ${version}` : ''}
      </Text>
    </View>
  );
}

/** Gives action and information rows the same restrained, appearance-aware icon tile. */
function SettingsRouteIcon({
  symbol,
  testID,
  tone,
}: {
  readonly symbol: string;
  readonly testID?: string;
  readonly tone: SettingsRowTone;
}) {
  return (
    <View
      style={[styles.icon, { backgroundColor: tones[tone].background }]}
      testID={testID}
    >
      <AppSymbol name={symbol} size={15} color={tones[tone].foreground} />
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
    width: 28,
    height: 28,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 48,
    paddingLeft: 16,
    paddingRight: 16,
  },
  pressed: { opacity: 0.62 },
  // The line starts at the label, not at the icon's leading edge.
  rowContent: {
    flex: 1,
    minHeight: 48,
    paddingVertical: 8,
    gap: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomColor: settingsListColors.separator,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowTitle: { flex: 1, minWidth: 0, color: appColors.text, fontSize: 16 },
});
