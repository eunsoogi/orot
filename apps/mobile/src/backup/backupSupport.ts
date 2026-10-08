import { prepareRecordingsForBackup } from './nativeBackupMigration';
import { prepareDatabaseForBackup } from '../storage/secureDatabase';

export type BackupSupportState = 'ready' | 'recoveryRequired' | 'unavailable';

export interface BackupPreparationOperations {
  prepareRecordings(): Promise<number>;
  prepareDatabase(): Promise<void>;
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? error.code
    : undefined;
}

export async function runBackupPreparation(
  operations: BackupPreparationOperations,
): Promise<BackupSupportState> {
  try {
    await operations.prepareRecordings();
    await operations.prepareDatabase();
    return 'ready';
  } catch (error) {
    const code = errorCode(error);
    if (
      code === 'EXISTING_DATABASE_KEY_MISSING' ||
      code === 'EXISTING_DATABASE_FILE_MISSING' ||
      code === 'PARTIAL_DATABASE_FILE_SET'
    ) {
      return 'recoveryRequired';
    }
    return 'unavailable';
  }
}

// This reports local restore eligibility only; iOS Settings owns backup completion and storage status.
export function prepareBackupSupport(): Promise<BackupSupportState> {
  return runBackupPreparation({
    prepareRecordings: prepareRecordingsForBackup,
    prepareDatabase: prepareDatabaseForBackup,
  });
}
