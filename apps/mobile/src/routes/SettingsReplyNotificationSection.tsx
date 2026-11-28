import { SettingsInformationButton } from './SettingsInformationButton';
import { SettingsNotificationDivider } from './SettingsNotificationDivider';
import { useEffect, useRef, useState } from 'react';
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

  const installedPreference = useRef<ReplyNotificationPreference | null>(null);
  const request = useRef(0);
  const saving = useRef(false);
  useEffect(() => {
    const retire = () => {
      request.current++;
    };
    let initializationPending = false;
    async function checkAuthorization() {
      const initialize = installedPreference.current === null;
      // The saved toggle belongs to this form. Only the OS permission can
      // change elsewhere while backgrounded, and it must still be rechecked.
      if (
        saving.current ||
        initializationPending ||
        (!initialize && !installedPreference.current?.enabled)
      )
        return;
      const revision = ++request.current;
      initializationPending = initialize;
      try {
        const native = nativeReplyNotifications();
        const value = initialize
          ? await native.read()
          : installedPreference.current;
        if (!value || revision !== request.current) return;
        const authorized = !value.enabled || (await native.authorized());
        if (revision !== request.current) return;
        if (initialize) {
          installedPreference.current = value;
          setPreference(value);
        }
        setStatus(authorized ? null : 'denied');
      } catch {
        if (revision === request.current) setStatus('error');
      } finally {
        if (initialize) initializationPending = false;
      }
    }
    checkAuthorization().catch(() => undefined);
    const listener = AppState.addEventListener('change', value => {
      if (value === 'active') checkAuthorization().catch(() => undefined);
    });
    return () => {
      retire();
      listener.remove();
    };
  }, []);

  async function save(value: ReplyNotificationPreference) {
    if (saving.current) return;
    saving.current = true;
    const revision = ++request.current;
    setBusy(true);
    try {
      const result = await nativeReplyNotifications().save(value);
      if (revision !== request.current) return;
      installedPreference.current = value;
      setPreference(value);
      setStatus(result === 'denied' || result === 'error' ? result : null);
    } catch {
      if (revision === request.current) setStatus('error');
    } finally {
      saving.current = false;
      if (revision === request.current) setBusy(false);
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
