import {
  ExistingDatabaseFileMissingError,
  ExistingDatabaseKeyMissingError,
  PartialDatabaseFileSetError,
} from '@orot/storage';
import { NativeModules } from 'react-native';

/** The secure storage smoke probe has its own existing opt-in setting. */
export function shouldLogStorageDiagnostics(): boolean {
  const settingsManager = (
    NativeModules as unknown as {
      SettingsManager?: {
        settings?: Record<string, unknown>;
        getConstants?: () => { settings?: Record<string, unknown> };
      };
    }
  ).SettingsManager;
  const settings =
    settingsManager?.settings ?? settingsManager?.getConstants?.().settings;
  return settings?.OROT_STORAGE_DIAGNOSTICS === 'enabled';
}

/** Limits opt-in storage diagnostics to fixed labels because native errors may contain paths or record data. */
export function formatStorageOpenDiagnostic(error: unknown): string {
  let code = 'STORAGE_OPEN_FAILED';
  if (error instanceof ExistingDatabaseKeyMissingError) {
    code = 'DATABASE_KEY_MISSING';
  } else if (error instanceof ExistingDatabaseFileMissingError) {
    code = 'DATABASE_FILE_MISSING';
  } else if (error instanceof PartialDatabaseFileSetError) {
    code = 'DATABASE_FILE_PARTIAL';
  }
  return `stage=encrypted_storage_open code=${code}`;
}
