import { NativeModules } from 'react-native';
import type { DatabaseFileState } from '@orot/storage';

export type DatabaseKeyMigrationResult =
  'migrated' | 'alreadyEligible' | 'missing';

interface BackupMigrationNativeModule {
  migrateDatabaseKeyForBackup(): Promise<DatabaseKeyMigrationResult>;
  isDatabaseKeyBackupEligible(): Promise<boolean>;
  databaseFileState(name: string, location: string): Promise<DatabaseFileState>;
  prepareRecordingsForBackup(): Promise<number>;
}

function nativeModule(): BackupMigrationNativeModule {
  const module = NativeModules.BackupMigrationModule as
    BackupMigrationNativeModule | undefined;
  if (!module) {
    throw new Error('The native backup preparation module is unavailable.');
  }
  return module;
}

export async function migrateDatabaseKeyForBackup(): Promise<DatabaseKeyMigrationResult> {
  const result = await nativeModule().migrateDatabaseKeyForBackup();
  if (
    result !== 'migrated' &&
    result !== 'alreadyEligible' &&
    result !== 'missing'
  ) {
    throw new Error('The database key migration returned an invalid result.');
  }
  return result;
}

export async function isDatabaseKeyBackupEligible(): Promise<boolean> {
  const result = await nativeModule().isDatabaseKeyBackupEligible();
  if (typeof result !== 'boolean') {
    throw new Error('The database key backup status is unavailable.');
  }
  return result;
}

export async function getDatabaseFileState(
  name: string,
  location: string,
): Promise<DatabaseFileState> {
  const result = await nativeModule().databaseFileState(name, location);
  if (result !== 'present' && result !== 'missing' && result !== 'partial') {
    throw new Error('The database file state is unavailable.');
  }
  return result;
}

export async function prepareRecordingsForBackup(): Promise<number> {
  const count = await nativeModule().prepareRecordingsForBackup();
  if (!Number.isInteger(count) || count < 0) {
    throw new Error('The recording backup preparation result is invalid.');
  }
  return count;
}
