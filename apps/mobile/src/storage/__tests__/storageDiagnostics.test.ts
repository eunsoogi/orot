import {
  ExistingDatabaseKeyMissingError,
  PartialDatabaseFileSetError,
} from '@orot/storage';
import { formatStorageOpenDiagnostic } from '../storageDiagnostics';

test('keeps sensitive native error details out of opt-in storage diagnostics', () => {
  const secretPath = '/private/health-records/orot-secure.db';
  const secretMarker = 'private-record-content-marker';
  const error = Object.assign(new Error(`${secretMarker} at ${secretPath}`), {
    name: 'SensitiveNativeErrorName',
  });

  // Native driver messages may embed paths or record values, so only a fixed diagnostic may escape.
  const diagnostic = formatStorageOpenDiagnostic(error);
  expect(diagnostic).toBe(
    'stage=encrypted_storage_open code=STORAGE_OPEN_FAILED',
  );
  expect(diagnostic).not.toContain(secretPath);
  expect(diagnostic).not.toContain(secretMarker);
  expect(diagnostic).not.toContain(error.name);
});

test('maps known restore failures to fixed diagnostic codes', () => {
  expect(
    formatStorageOpenDiagnostic(new ExistingDatabaseKeyMissingError()),
  ).toBe('stage=encrypted_storage_open code=DATABASE_KEY_MISSING');
  expect(formatStorageOpenDiagnostic(new PartialDatabaseFileSetError())).toBe(
    'stage=encrypted_storage_open code=DATABASE_FILE_PARTIAL',
  );
});
