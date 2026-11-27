import { StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { NAVIGATION_CONTENT_GAP } from '../navigation/navigationLayout';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
import { settingsListColors } from './settingsListColors';
import { SettingsDailyReminderSection } from './SettingsDailyReminderSection';
import { SettingsReplyNotificationSection } from './SettingsReplyNotificationSection';

/** Keeps notification controls in their own measured, scrollable Settings page. */
export function SettingsNotificationsRoute() {
  useNavigationLeaveStateRegistration({
    canLeave: true,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: false,
    revision: 0,
    inputRevision: 0,
  });
  return (
    <NavigationRouteScrollView testID="settings-notifications-scroll">
      <View style={styles.page}>
        <AdaptiveColumns
          routeKey="settings-notifications"
          testID="settings-notifications-layout"
          primary={
            <View style={styles.content} testID="settings-notifications">
              <Text
                accessibilityRole="header"
                style={styles.title}
                testID="settings-notifications-title"
              >
                {t('settings.notifications')}
              </Text>
              <SettingsDailyReminderSection />
              <SettingsReplyNotificationSection />
            </View>
          }
        />
      </View>
    </NavigationRouteScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    flexGrow: 1,
  },
  content: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 680,
    gap: 20,
    minWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28 - NAVIGATION_CONTENT_GAP,
  },
  title: { color: appColors.text, fontSize: 30, fontWeight: '700' },
});
