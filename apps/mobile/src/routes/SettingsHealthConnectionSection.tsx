import { useEffect, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { healthKit } from '../healthkit';
import { t } from '../i18n';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';

/** Availability is not a grant: reading it never asks HealthKit for access or samples. */
export function SettingsHealthConnectionSection() {
  const [status, setStatus] = useState<
    'available' | 'unavailable' | 'unknown'
  >();
  useEffect(() => {
    let sequence = 0;
    let settled = false;
    let pending = false;
    const read = async () => {
      if (settled || pending) return;
      pending = true;
      const request = ++sequence;
      try {
        const result = await healthKit.getAvailability();
        if (request === sequence) {
          // Device capability is not the mutable Health permission.
          settled = true;
          setStatus(
            result.status === 'unsupportedPlatform'
              ? 'unavailable'
              : result.status,
          );
        }
      } catch {
        if (request === sequence) setStatus('unknown');
      } finally {
        pending = false;
      }
    };
    read();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') read();
    });
    return () => {
      sequence += 1;
      subscription.remove();
    };
  }, []);

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>
        {t('settings.healthData.connection')}
      </Text>
      <Text style={styles.body} testID="health-data-connection-status">
        {t(
          status === 'available'
            ? 'settings.healthData.connectionAvailable'
            : status === 'unavailable'
              ? 'settings.healthData.connectionUnavailable'
              : status === 'unknown'
                ? 'settings.healthData.connectionUnknown'
                : 'settings.healthData.statusLoading',
        )}
      </Text>
      <Text style={styles.body} testID="health-data-permission-status">
        {t('settings.healthData.permissionNote')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: appColors.surface,
    borderRadius: 18,
    gap: 8,
    padding: 16,
  },
  title: { color: appColors.text, fontSize: 17, fontWeight: '700' },
  body: { color: appColors.secondary, fontSize: 14, lineHeight: 21 },
});
