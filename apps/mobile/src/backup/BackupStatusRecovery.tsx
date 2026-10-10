import { StyleSheet, View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { appColors } from '../layout/appColors';
import { t } from '../i18n';
import type { BackupPreparationDisplayState } from './useBackupPreparation';

function messageKey(state: BackupPreparationDisplayState) {
  switch (state) {
    case 'checking':
      return 'backup.status.checking';
    case 'ready':
      return 'backup.status.ready';
    case 'recoveryRequired':
      return 'backup.status.recoveryRequired';
    case 'unavailable':
      return 'backup.status.unavailable';
  }
}

interface BackupStatusRecoveryProps {
  readonly state: BackupPreparationDisplayState;
  readonly onRetry: () => Promise<void>;
}

/** Shows the app-owned preparation result only in Settings; preparation starts at launch. */
export default function BackupStatusRecovery({
  state,
  onRetry,
}: BackupStatusRecoveryProps) {
  return (
    <View
      accessibilityLabel={t('backup.title')}
      style={styles.container}
      testID="backup-status-recovery"
    >
      <Text accessibilityRole="header" style={styles.title}>
        {t('backup.title')}
      </Text>
      <Text style={styles.copy}>{t('backup.description')}</Text>
      <Text
        accessibilityLiveRegion="polite"
        style={styles.copy}
        testID="backup-status-message"
      >
        {t(messageKey(state))}
      </Text>
      <Text style={styles.copy}>{t('backup.settingsPath')}</Text>
      <Button
        disabled={state === 'checking'}
        onPress={onRetry}
        testID="backup-prepare"
        title={t('backup.prepare')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  title: { color: appColors.text, fontSize: 15, fontWeight: '600' },
  copy: { color: appColors.secondary, fontSize: 14, lineHeight: 21 },
});
