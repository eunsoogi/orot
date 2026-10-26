import { NativeModules } from 'react-native';
import type { BackupProbeMode } from './backupProbeTypes';

function backupProbeSettings(): Record<string, unknown> {
  const settingsManager = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  return (
    settingsManager?.settings ??
    settingsManager?.getConstants?.().settings ??
    {}
  );
}

export function getBackupProbeMode(): BackupProbeMode | null {
  const value = backupProbeSettings().OROT_BACKUP_PROBE;
  return value === 'seed' ||
    value === 'recover' ||
    value === 'legacy-recording' ||
    value === 'rollback' ||
    value === 'rollback-recover' ||
    value === 'snapshot-seed' ||
    value === 'snapshot-recover'
    ? value
    : null;
}

// Accept only a UUID before using the launch argument to select a permanent recording.
export function getBackupProbeRecordingId(): string | null {
  const value = backupProbeSettings().OROT_BACKUP_PROBE_RECORDING_ID;
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
    ? value.toLowerCase()
    : null;
}
