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

/** Keeps permission detail and recovery controls in Settings so Schedule stays focused. */
export function SettingsCalendarSyncSection({
  sync,
  onOpenSystemSettings,
}: {
  readonly sync: CalendarAutoSyncActions;
  readonly onOpenSystemSettings: () => void;
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
      <Text style={styles.note} testID="settings-calendar-permission-note">
        {t('calendar.permissionExplanation')}
      </Text>
      <Text
        accessibilityLiveRegion="polite"
        accessibilityRole={sync.error ? 'alert' : undefined}
        style={sync.error ? styles.error : styles.message}
        testID="settings-calendar-sync-message"
      >
        {status}
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
      {sync.updatedAt ? (
        <Text
          style={styles.timestamp}
          testID="settings-calendar-sync-updated-at"
        >
          {t('settings.syncStatus.calendar.updatedAt', {
            timestamp: formatDateTime(new Date(sync.updatedAt)),
          })}
        </Text>
      ) : null}
      {sync.access !== 'fullAccess' ? (
        <AppButton
          accessibilityState={{ busy: requestingAccess }}
          disabled={requestingAccess}
          onPress={() => void requestAccess()}
          testID="settings-calendar-request-access"
          title={
            requestingAccess
              ? t('settings.syncStatus.calendar.requestingAccess')
              : t('settings.syncStatus.calendar.requestAccess')
          }
        />
      ) : null}
      <AppButton
        accessibilityState={{ busy: sync.loading }}
        disabled={sync.loading || sync.access !== 'fullAccess'}
        onPress={() => void sync.refresh()}
        testID="settings-calendar-refresh"
        title={
          sync.loading
            ? t('settings.syncStatus.calendar.refreshing')
            : t('settings.syncStatus.calendar.refresh')
        }
      />
      {sync.access === 'denied' || sync.access === 'restricted' ? (
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
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
    padding: 16,
  },
  sectionTitle: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  note: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
  message: { color: appColors.text, fontSize: 14, lineHeight: 21 },
  timestamp: { color: appColors.secondary, fontSize: 13, lineHeight: 19 },
  error: { color: appColors.danger, fontSize: 14, lineHeight: 21 },
});
