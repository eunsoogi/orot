import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { AppButton as Button } from '../layout/AppButton';
import { t } from '../i18n';
import { prepareBackupSupport } from './backupSupport';
import type { BackupSupportState } from './backupSupport';

type DisplayState = BackupSupportState | 'checking';

function messageKey(state: DisplayState) {
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

export default function BackupStatusRecovery() {
  const [state, setState] = useState<DisplayState>('checking');

  useEffect(() => {
    let mounted = true;
    void prepareBackupSupport().then(nextState => {
      if (mounted) setState(nextState);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function retry() {
    setState('checking');
    setState(await prepareBackupSupport());
  }

  return (
    <View
      accessibilityLabel={t('backup.title')}
      testID="backup-status-recovery"
    >
      <Text accessibilityRole="header">{t('backup.title')}</Text>
      <Text>{t('backup.description')}</Text>
      <Text accessibilityLiveRegion="polite">{t(messageKey(state))}</Text>
      <Text>{t('backup.settingsPath')}</Text>
      {state !== 'ready' ? (
        <Button onPress={() => void retry()} title={t('backup.retry')} />
      ) : null}
    </View>
  );
}
