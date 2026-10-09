import {
  ExistingDatabaseFileMissingError,
  ExistingDatabaseKeyMissingError,
  PartialDatabaseFileSetError,
} from '@orot/storage';

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
