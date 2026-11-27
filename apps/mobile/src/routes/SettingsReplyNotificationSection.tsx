import { SettingsInformationButton } from './SettingsInformationButton';
import { SettingsNotificationDivider } from './SettingsNotificationDivider';
import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { SettingsNotificationToggleRow } from './SettingsNotificationToggleRow';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import {
  nativeReplyNotifications,
  type ReplyNotificationPreference,
} from '../replyNotifications/nativeReplyNotifications';

/** Explicit settings changes own permission requests and the health-preview notice. */
export function SettingsReplyNotificationSection() {
  const [preference, setPreference] =
    useState<ReplyNotificationPreference | null>(null);
  const [status, setStatus] = useState<'denied' | 'error' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const native = nativeReplyNotifications();
        const value = await native.read();
        const authorized = !value.enabled || (await native.authorized());
        if (active) {
          setPreference(value);
          setStatus(authorized ? null : 'denied');
        }
      } catch {
        if (active) setStatus('error');
      }
    };
    refresh().catch(() => undefined);
    const listener = AppState.addEventListener('change', value => {
      if (value === 'active') refresh().catch(() => undefined);
    });
    return () => {
      active = false;
      listener.remove();
    };
  }, []);

  async function save(value: ReplyNotificationPreference) {
    setBusy(true);
    try {
      const result = await nativeReplyNotifications().save(value);
      setPreference(value);
      setStatus(result === 'denied' || result === 'error' ? result : null);
    } catch {
      setStatus('error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.section} testID="settings-section-reply-notifications">
      <View style={styles.sectionHeading}>
        <Text accessibilityRole="header" style={styles.title}>
          {t('settings.replyNotification.title')}
        </Text>
        <SettingsInformationButton
          title={t('settings.replyNotification.title')}
          message={t('settings.replyNotification.description')}
          testID="settings-reply-notification-info"
        />
      </View>
      <View style={styles.card}>
        <SettingsNotificationToggleRow
          testID="settings-reply-notification"
          label={t('settings.replyNotification.enabled')}
          hint={
            preference?.preview
              ? t('settings.replyNotification.previewRisk')
              : undefined
          }
          disabled={busy || !preference}
          value={preference?.enabled ?? false}
          onToggle={() => {
            if (preference)
              save({ ...preference, enabled: !preference.enabled }).catch(
                () => undefined,
              );
          }}
        />
        <SettingsNotificationDivider inset={16} />
        <SettingsNotificationToggleRow
          testID="settings-reply-preview"
          label={t('settings.replyNotification.preview')}
          hint={t('settings.replyNotification.previewRisk')}
          disabled={busy || !preference?.enabled}
          value={preference?.preview ?? true}
          onToggle={() => {
            if (preference)
              save({ ...preference, preview: !preference.preview }).catch(
                () => undefined,
              );
          }}
        />
        {/* Keep the warning visible before opt-in without shifting the title row's center. */}
        <Text style={styles.previewRisk}>
          {t('settings.replyNotification.previewRisk')}
        </Text>
        {status && (
          <Text accessibilityRole="alert" style={styles.status}>
            {t(
              status === 'denied'
                ? 'settings.replyNotification.denied'
                : 'settings.replyNotification.error',
            )}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  sectionHeading: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    paddingLeft: 16,
  },
  title: {
    color: appColors.secondary,
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: 0,
    overflow: 'hidden',
  },
  status: { color: appColors.danger, fontSize: 14, padding: 16 },
  previewRisk: {
    color: appColors.secondary,
    fontSize: 13,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
});
