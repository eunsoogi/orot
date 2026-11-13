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
    <View style={styles.section}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('settings.replyNotification.title')}
      </Text>
      <View style={styles.card}>
        <Text style={styles.description}>
          {t('settings.replyNotification.description')}
        </Text>
        <View style={styles.row}>
          <Text style={styles.label}>
            {t('settings.replyNotification.enabled')}
          </Text>
          <ReplySwitch
            label={t('settings.replyNotification.enabled')}
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
        <View style={styles.row}>
          <Text style={styles.label}>
            {t('settings.replyNotification.preview')}
          </Text>
          <ReplySwitch
            label={t('settings.replyNotification.preview')}
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
          <Text accessibilityRole="alert" style={styles.description}>
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
  disabled,
  value,
  onToggle,
}: {
  label: string;
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
  title: {
    color: appColors.secondary,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  card: {
    backgroundColor: appColors.surface,
    borderColor: appColors.border,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
  },
  description: { color: appColors.secondary, fontSize: 15 },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    minHeight: 60,
  },
  label: { color: appColors.text, flex: 1, fontSize: 17 },
});
