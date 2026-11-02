import { StyleSheet, View } from 'react-native';
import type { ColorValue } from 'react-native';
import { AppButton } from '../layout/AppButton';
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
    <AppButton
      leadingContent={<SettingsRouteIcon symbol={symbol} tone={tone} />}
      onPress={onPress}
      size="compact"
      summary={summary}
      testID={testID}
      title={title}
      trailingContent={
        <AppSymbol name="chevron.right" size={14} color={appColors.secondary} />
      }
      variant="list"
    />
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
      <AppSymbol name={symbol} color={tones[tone].foreground} />
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
  rowTitle: { color: appColors.text, fontSize: 16, fontWeight: '500' },
});
