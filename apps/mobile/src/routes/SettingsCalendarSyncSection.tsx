import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CalendarAccessState } from '../calendar/types';
import type { CalendarAutoSyncActions } from '../calendar/useCalendarAutoSync';
import { AppButton } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { formatDateTime, t } from '../i18n';

function messageForAccess(access: CalendarAccessState): string {
  switch (access) {
    case 'fullAccess':
      return t('settings.syncStatus.calendar.fullAccess');
    case 'writeOnly':
      return t('settings.syncStatus.calendar.writeOnly');
    case 'notDetermined':
      return t('settings.syncStatus.calendar.notDetermined');
    case 'denied':
      return t('settings.syncStatus.calendar.denied');
    case 'restricted':
      return t('settings.syncStatus.calendar.restricted');
  }
}

/** Separates OS permission actions from the calendar sync checkpoint and refresh. */
export function SettingsCalendarSyncSection({
  sync,
  onOpenSystemSettings,
  mode,
}: {
  readonly sync: CalendarAutoSyncActions;
  readonly onOpenSystemSettings?: () => void;
  readonly mode: 'permission' | 'sync';
}) {
  const [requestingAccess, setRequestingAccess] = useState(false);
  const status = sync.loading
    ? t('settings.syncStatus.calendar.loading')
    : sync.access
      ? messageForAccess(sync.access)
      : t('settings.syncStatus.calendar.notChecked');

  async function requestAccess() {
    if (requestingAccess) return;
    setRequestingAccess(true);
    try {
      await sync.requestAccess();
    } finally {
      setRequestingAccess(false);
    }
  }

  return (
    <View style={styles.card} testID="settings-calendar-sync-section">
      <Text style={styles.sectionTitle}>
        {t('settings.syncStatus.calendar')}
      </Text>
      {mode === 'permission' ? (
        <Text style={styles.note} testID="settings-calendar-permission-note">
          {t('calendar.permissionExplanation')}
        </Text>
      ) : null}
      <Text
        accessibilityLiveRegion="polite"
        accessibilityRole={sync.error ? 'alert' : undefined}
        style={sync.error ? styles.error : styles.message}
        testID="settings-calendar-sync-message"
      >
        {mode === 'permission' || sync.access === 'fullAccess' || sync.loading
          ? status
          : t('settings.syncStatus.calendar.notChecked')}
      </Text>
      {sync.error ? (
        <Text
          accessibilityRole="alert"
          style={styles.error}
          testID="settings-calendar-sync-error"
        >
          {t('settings.syncStatus.calendar.error')}
        </Text>
      ) : null}
      {mode === 'sync' && sync.updatedAt ? (
        <Text
          style={styles.timestamp}
          testID="settings-calendar-sync-updated-at"
        >
          {t('settings.syncStatus.calendar.updatedAt', {
            timestamp: formatDateTime(new Date(sync.updatedAt)),
          })}
        </Text>
      ) : null}
      {mode === 'permission' && sync.access !== 'fullAccess' ? (
        <AppButton
          accessibilityState={{ busy: requestingAccess }}
          disabled={requestingAccess}
          onPress={() => {
            requestAccess();
          }}
          testID="settings-calendar-request-access"
          title={
            requestingAccess
              ? t('settings.syncStatus.calendar.requestingAccess')
              : t('settings.syncStatus.calendar.requestAccess')
          }
        />
      ) : null}
      {mode === 'sync' ? (
        <AppButton
          accessibilityState={{ busy: sync.loading }}
          disabled={sync.loading || sync.access !== 'fullAccess'}
          onPress={() => {
            sync.refresh();
          }}
          testID="settings-calendar-refresh"
          title={
            sync.loading
              ? t('settings.syncStatus.calendar.refreshing')
              : t('settings.syncStatus.calendar.refresh')
          }
        />
      ) : null}
      {mode === 'permission' &&
      onOpenSystemSettings &&
      (sync.access === 'denied' || sync.access === 'restricted') ? (
        <AppButton
          onPress={onOpenSystemSettings}
          testID="settings-calendar-open-system-settings"
          title={t('settings.syncStatus.openSettings')}
          variant="secondary"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 18,
    borderWidth: 0,
    gap: 8,
    padding: 16,
  },
  sectionTitle: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  note: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
  message: { color: appColors.text, fontSize: 14, lineHeight: 21 },
  timestamp: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
  error: { color: appColors.danger, fontSize: 14, lineHeight: 21 },
});
