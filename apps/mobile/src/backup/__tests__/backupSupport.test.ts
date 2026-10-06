import { runBackupPreparation } from '../backupSupport';

// The pure orchestrator tests do not need to load native SQLite or Keychain modules.
jest.mock('../../storage/secureDatabase', () => ({
  prepareDatabaseForBackup: jest.fn(),
}));
jest.mock('../nativeBackupMigration', () => ({
  prepareRecordingsForBackup: jest.fn(),
}));

test('reports eligibility only after recordings and database preparation both succeed', async () => {
  const prepareRecordings = jest.fn(async () => 0);
  const prepareDatabase = jest.fn(async () => undefined);

  await expect(
    runBackupPreparation({ prepareRecordings, prepareDatabase }),
  ).resolves.toBe('ready');
  expect(prepareRecordings).toHaveBeenCalledTimes(1);
  expect(prepareDatabase).toHaveBeenCalledTimes(1);
});

test('keeps a restored database with a missing key in recovery instead of reporting readiness', async () => {
  const prepareDatabase = jest.fn(async () => {
    throw Object.assign(
      new Error('The encryption key for an existing database is missing.'),
      {
        code: 'EXISTING_DATABASE_KEY_MISSING',
      },
    );
  });

  await expect(
    runBackupPreparation({
      prepareRecordings: async () => 0,
      prepareDatabase,
    }),
  ).resolves.toBe('recoveryRequired');
});

test('keeps a partial restore with a missing database file in recovery', async () => {
  await expect(
    runBackupPreparation({
      prepareRecordings: async () => 0,
      async prepareDatabase() {
        throw Object.assign(
          new Error('The existing database file is missing.'),
          {
            code: 'EXISTING_DATABASE_FILE_MISSING',
          },
        );
      },
    }),
  ).resolves.toBe('recoveryRequired');
});

test('keeps orphaned SQLite sidecars in recovery without opening a replacement database', async () => {
  await expect(
    runBackupPreparation({
      prepareRecordings: async () => 0,
      async prepareDatabase() {
        throw Object.assign(
          new Error(
            'SQLite sidecar files exist without the main database file.',
          ),
          { code: 'PARTIAL_DATABASE_FILE_SET' },
        );
      },
    }),
  ).resolves.toBe('recoveryRequired');
});

test('does not report readiness when database-key eligibility migration fails', async () => {
  const prepareDatabase = jest.fn(async () => {
    throw Object.assign(new Error('The database key could not be updated.'), {
      code: 'BACKUP_PREPARATION_FAILED',
    });
  });

  await expect(
    runBackupPreparation({
      prepareRecordings: async () => 0,
      prepareDatabase,
    }),
  ).resolves.toBe('unavailable');
});

test('does not continue to database preparation when recording files cannot be migrated', async () => {
  const prepareDatabase = jest.fn(async () => undefined);

  await expect(
    runBackupPreparation({
      prepareRecordings: async () => {
        throw new Error('Recording metadata could not be updated.');
      },
      prepareDatabase,
    }),
  ).resolves.toBe('unavailable');
  expect(prepareDatabase).not.toHaveBeenCalled();
});
