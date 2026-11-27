import { StyleSheet, View } from 'react-native';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { settingsListColors } from './settingsListColors';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { SettingsAutomaticMemorySection } from './SettingsAutomaticMemorySection';
import { SettingsDailyReportMemorySection } from './SettingsDailyReportMemorySection';

export function SettingsMemoryRoute({
  ownership,
}: { readonly ownership?: NavigationRouteOwnership } = {}) {
  // Navigating back retires the same guarded write ownership as leaving Privacy did.
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  return (
    <NavigationRouteScrollView testID="settings-memory-scroll">
      <View style={styles.background}>
        <AdaptiveColumns
          routeKey="settings-memory"
          testID="settings-memory-layout"
          primary={
            <View style={styles.page}>
              <AppText
                accessibilityRole="header"
                style={styles.title}
                testID="settings-memory-title"
              >
                {t('settings.memory')}
              </AppText>
              <View style={styles.group} testID="settings-memory-controls">
                <SettingsAutomaticMemorySection ownership={ownership} />
                <View style={styles.divider} />
                <SettingsAutomaticMemorySection ownership={ownership} routine />
                <View style={styles.divider} />
                <SettingsDailyReportMemorySection ownership={ownership} />
              </View>
            </View>
          }
        />
      </View>
    </NavigationRouteScrollView>
  );
}
const styles = StyleSheet.create({
  background: { flexGrow: 1, backgroundColor: settingsListColors.background },
  page: {
    flexGrow: 1,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 680,
    padding: 20,
    gap: 20,
  },
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
  group: { backgroundColor: settingsListColors.row, borderRadius: 18 },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: settingsListColors.separator,
    marginHorizontal: 16,
  },
});
