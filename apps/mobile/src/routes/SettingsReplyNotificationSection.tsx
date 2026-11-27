import { SettingsInformationButton } from './SettingsInformationButton';
import { SettingsNotificationDivider } from './SettingsNotificationDivider';
import { useEffect, useState } from 'react';
import { AppState, Pressable, StyleSheet, Switch, View } from 'react-native';
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
        <View style={styles.row}>
          <Text style={styles.label}>
            {t('settings.replyNotification.enabled')}
          </Text>
          <ReplySwitch
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
        </View>
        <SettingsNotificationDivider inset={16} />
        <View style={styles.row}>
          <View style={styles.previewCopy}>
            <Text style={styles.previewTitle}>
              {t('settings.replyNotification.preview')}
            </Text>
            {/* Keep the privacy warning visible before anyone enables previews. */}
            <Text style={styles.previewRisk}>
              {t('settings.replyNotification.previewRisk')}
            </Text>
          </View>
          <ReplySwitch
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
        </View>
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

/** The wrapper owns the 44-point touch target and the accessible switch state. */
function ReplySwitch({
  label,
  hint,
  disabled,
  value,
  onToggle,
}: {
  label: string;
  hint?: string;
  disabled: boolean;
  value: boolean;
  onToggle: () => void;
}) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const padding = {
    paddingHorizontal: size.width ? Math.max(0, (44 - size.width) / 2) : 0,
    paddingVertical: size.height ? Math.max(0, (44 - size.height) / 2) : 0,
  };
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={[styles.control, padding]}
    >
      <Switch
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
        value={value}
        disabled={disabled}
        onLayout={event => {
          const { width, height } = event.nativeEvent.layout;
          setSize(current =>
            current.width === width && current.height === height
              ? current
              : { width, height },
          );
        }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  control: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
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
  previewCopy: { flex: 1, minWidth: 0, gap: 4 },
  previewTitle: { color: appColors.text, fontSize: 17 },
  previewRisk: { color: appColors.secondary, fontSize: 13 },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 60,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  label: { color: appColors.text, flex: 1, fontSize: 17 },
});
