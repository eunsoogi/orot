/* global afterEach, expect, jest, test */
jest.mock('../src/backup/nativeBackupMigration', () => ({
  isDatabaseKeyBackupEligible: jest.fn(),
  migrateDatabaseKeyForBackup: jest.fn(),
}));
jest.mock('../src/memory/agentMemoryProbe', () => ({
  runAgentMemoryProbe: jest.fn(),
}));
jest.mock('../src/recording/nativeRecordingBridge', () => ({
  installSyntheticTranscriptionRecording: jest.fn(),
  removeSyntheticTranscriptionRecording: jest.fn(),
}));
jest.mock('../src/storage/e2eProbe', () => ({ runStorageProbe: jest.fn() }));
jest.mock('../src/storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));
jest.mock('./backupProbeConfig', () => ({
  getBackupProbeRecordingId: jest.fn(),
}));
jest.mock('./backupProbeNative', () => ({
  requireNativeBackupProbe: jest.fn(),
}));
jest.mock('./backupProbePreparation', () => ({
  verifyRecordingProbeState: jest.fn(),
}));
jest.mock('./backupProbeRecording', () => ({
  createBackupProbeTranscript: jest.fn(),
}));

const {
  isDatabaseKeyBackupEligible,
  migrateDatabaseKeyForBackup,
} = require('../src/backup/nativeBackupMigration');
const { runStorageProbe } = require('../src/storage/e2eProbe');
const {
  removeSyntheticTranscriptionRecording,
} = require('../src/recording/nativeRecordingBridge');
const { getBackupProbeRecordingId } = require('./backupProbeConfig');
const { recoverSnapshotProbe } = require('./backupProbeSnapshot');

afterEach(() => jest.clearAllMocks());

test('cleans the restored fixture when key migration fails', async () => {
  const recordingId = '00000000-0000-4000-8000-000000000001';
  const migrationFailure = new Error('synthetic migration failure');
  let finishCleanup;
  let recoverySettled = false;

  getBackupProbeRecordingId.mockReturnValue(recordingId);
  migrateDatabaseKeyForBackup.mockRejectedValue(migrationFailure);
  // Hold cleanup open to prove the rejected recovery waits for fixture removal.
  removeSyntheticTranscriptionRecording.mockReturnValue(
    new Promise(resolve => {
      finishCleanup = resolve;
    }),
  );

  const recovery = recoverSnapshotProbe().then(
    () => {
      recoverySettled = true;
      return undefined;
    },
    error => {
      recoverySettled = true;
      return error;
    },
  );
  await Promise.resolve();
  expect(removeSyntheticTranscriptionRecording).toHaveBeenCalledWith(
    recordingId,
  );
  expect(recoverySettled).toBe(false);

  finishCleanup?.();
  await expect(recovery).resolves.toBe(migrationFailure);
});

test('cleans the restored fixture when storage restart probing fails', async () => {
  const recordingId = '00000000-0000-4000-8000-000000000002';
  const storageFailure = new Error('synthetic storage restart failure');
  let finishCleanup;
  let signalCleanupStarted;
  let recoverySettled = false;
  const cleanupStarted = new Promise(resolve => {
    signalCleanupStarted = resolve;
  });

  getBackupProbeRecordingId.mockReturnValue(recordingId);
  migrateDatabaseKeyForBackup.mockResolvedValue(undefined);
  isDatabaseKeyBackupEligible.mockResolvedValue(true);
  runStorageProbe.mockRejectedValue(storageFailure);
  // Hold cleanup open to prove later restore failures await fixture removal.
  removeSyntheticTranscriptionRecording.mockImplementation(() => {
    signalCleanupStarted?.();
    return new Promise(resolve => {
      finishCleanup = resolve;
    });
  });

  const recovery = recoverSnapshotProbe().then(
    () => {
      recoverySettled = true;
      return undefined;
    },
    error => {
      recoverySettled = true;
      return error;
    },
  );
  await cleanupStarted;
  expect(runStorageProbe).toHaveBeenCalledWith('restart');
  expect(removeSyntheticTranscriptionRecording).toHaveBeenCalledWith(
    recordingId,
  );
  expect(recoverySettled).toBe(false);

  finishCleanup?.();
  await expect(recovery).resolves.toBe(storageFailure);
});
