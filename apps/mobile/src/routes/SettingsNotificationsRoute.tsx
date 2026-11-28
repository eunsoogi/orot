import { PageHeading } from '../layout/PageHeading';
import { settingsPageStyles } from '../layout/settingsPagePresentation';
import { StyleSheet, View } from 'react-native';
import { t } from '../i18n';
import { AdaptiveColumns } from '../layout/AdaptiveColumns';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { NAVIGATION_CONTENT_GAP } from '../navigation/navigationLayout';
import { NavigationRouteScrollView } from '../navigation/NavigationRouteScrollView';
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
              <PageHeading testID="settings-notifications-title">
                {t('settings.notifications')}
              </PageHeading>
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
    // The AdaptiveColumns lane already excludes space reserved by navigation.
    width: '100%',
    gap: 20,
    minWidth: 0,
    ...settingsPageStyles.inset,
    paddingBottom: 28 - NAVIGATION_CONTENT_GAP,
  },
});
