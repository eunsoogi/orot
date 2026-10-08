import { NativeModules } from 'react-native';
import type { NativeBackupProbeModule } from './backupProbeTypes';

// The probe bridge exists only in the dedicated Simulator build configuration.
export function requireNativeBackupProbe(): NativeBackupProbeModule {
  const module = NativeModules.BackupMigrationModule as
    NativeBackupProbeModule | undefined;
  if (
    !module?.armPostUpdateReadbackFailureForProbe ||
    !module.postUpdateReadbackFailureWasTriggeredForProbe ||
    !module.prepareLegacyRecordingForBackupProbe ||
    !module.inspectRecordingForBackupProbe ||
    !module.backupKeyAccessibilityForProbe
  ) {
    throw new Error('The dedicated backup-probe bridge is unavailable.');
  }
  return module;
}
