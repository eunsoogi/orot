import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import {
  isDatabaseKeyBackupEligible,
  migrateDatabaseKeyForBackup,
  prepareRecordingsForBackup,
} from '../src/backup/nativeBackupMigration';
import { prepareRecordingBackup } from '../src/backup/recordingBackupPreparation';
import { runAgentMemoryProbe } from '../src/memory/agentMemoryProbe';
import {
  installSyntheticTranscriptionRecording,
  removeSyntheticTranscriptionRecording,
} from '../src/recording/nativeRecordingBridge';
import { saveRecordingSource } from '../src/recording/recordingPersistence';
import { openLocalStorage } from '../src/storage/secureDatabase';
import { runStorageProbe } from '../src/storage/e2eProbe';
import syntheticFixture from './transcription/fixtures/synthetic-korean.json';
import {
  prepareLegacyRecording,
  runKeyRollbackProbe,
  verifyRollbackRecovery,
} from './backupProbeRecording';
import { recoverSnapshotProbe, seedSnapshotProbe } from './backupProbeSnapshot';
import type { BackupProbeMode, BackupProbeResult } from './backupProbeTypes';

export { getBackupProbeMode } from './backupProbeConfig';
export type { BackupProbeMode, BackupProbeResult } from './backupProbeTypes';

// This probe targets the stable native service without ever displaying its secret value.
const databaseKeyService = 'com.orot.mobile.database-encryption-key.v1';
const databaseKeyAccount = 'database';

async function readDatabaseKey() {
  const credentials = await getGenericPassword({ service: databaseKeyService });
  if (credentials === false || credentials.username !== databaseKeyAccount) {
    throw new Error('The synthetic database key is unavailable.');
  }
  return credentials;
}

async function seedInterruptedMigration(): Promise<BackupProbeResult> {
  // Seed database, provenance, transcript, and search records before restarting the app process.
  await runStorageProbe('fresh');
  // Exercise the existing memory removal contract before the app process restarts.
  await runAgentMemoryProbe('fresh');
  await runAgentMemoryProbe('delete');
  const original = await readDatabaseKey();
  const saved = await setGenericPassword(
    databaseKeyAccount,
    original.password,
    {
      service: databaseKeyService,
      accessible: ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    },
  );
  if (saved === false)
    throw new Error('The synthetic Keychain state was not saved.');

  let migrationRejected = false;
  try {
    await migrateDatabaseKeyForBackup();
  } catch {
    migrationRejected = true;
  }
  const afterFailure = await readDatabaseKey();
  if (!migrationRejected || afterFailure.password !== original.password) {
    throw new Error('A failed migration changed the existing database key.');
  }
  return { keyPreserved: true };
}

async function verifyRecoveryAndBackupEligibility(): Promise<BackupProbeResult> {
  // The restarted process retries migration, then opens the same encrypted database with its saved key.
  await runStorageProbe('restart');
  await runAgentMemoryProbe('tombstone-restart');
  const original = await readDatabaseKey();
  const restored = await setGenericPassword(
    databaseKeyAccount,
    original.password,
    {
      service: databaseKeyService,
      accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
  if (restored === false)
    throw new Error('The eligible migration fixture was not saved.');

  const keyMigration = await migrateDatabaseKeyForBackup();
  const migrated = await readDatabaseKey();
  const keyEligible = await isDatabaseKeyBackupEligible();
  if (
    keyMigration !== 'migrated' ||
    migrated.password !== original.password ||
    !keyEligible
  ) {
    throw new Error(
      'The existing SQLCipher key did not retain its bytes and eligibility.',
    );
  }

  const audio = syntheticFixture.cases[0]?.audio;
  if (!audio)
    throw new Error('The synthetic recording fixture is unavailable.');
  const recording = await installSyntheticTranscriptionRecording(audio.base64);
  let sourcePersisted = false;
  try {
    const strictPreparation = await prepareRecordingBackup(
      recording.fileProtection,
      prepareRecordingsForBackup,
    );
    if (recording.excludedFromBackup) {
      throw new Error(
        'The permanent synthetic recording remained backup-excluded.',
      );
    }
    if (
      recording.fileProtection === 'unverified' &&
      strictPreparation === 'ready'
    ) {
      throw new Error(
        'The probe cannot claim readiness with unverified protection.',
      );
    }

    if (
      recording.fileProtection === 'complete' &&
      strictPreparation === 'ready'
    ) {
      const source = await saveRecordingSource(recording);
      sourcePersisted =
        source.id === recording.id && source.sourceKind === 'audio_recording';
      if (!sourcePersisted)
        throw new Error('The permanent recording source was not persisted.');
    } else {
      let persistenceRejected = false;
      try {
        await saveRecordingSource(recording);
      } catch (error) {
        persistenceRejected =
          error instanceof Error &&
          (error as Error & { code?: string }).code ===
            'RECORDING_FILE_PROTECTION_FAILED';
      }
      const repository = await openLocalStorage();
      sourcePersisted = Boolean(
        await repository.get('source_record', recording.id),
      );
      if (!persistenceRejected || sourcePersisted) {
        throw new Error('An unverified recording was persisted as complete.');
      }
    }

    return {
      evidenceScope: 'synthetic-simulator-process-restart',
      keyMigration,
      keyPreserved: true,
      keyEligible,
      storageRelationsReopened: true,
      agentMemoryTombstonePreserved: true,
      recording: {
        fileProtection: recording.fileProtection,
        excludedFromBackup: recording.excludedFromBackup,
        strictPreparation,
        sourcePersisted,
      },
    };
  } finally {
    // Remove synthetic audio after checking its local protection and backup flags.
    await removeSyntheticTranscriptionRecording(recording.id);
  }
}

export function runBackupProbe(
  mode: BackupProbeMode,
): Promise<BackupProbeResult> {
  switch (mode) {
    case 'seed':
      return seedInterruptedMigration();
    case 'recover':
      return verifyRecoveryAndBackupEligibility();
    case 'legacy-recording':
      return prepareLegacyRecording();
    case 'rollback':
      return runKeyRollbackProbe();
    case 'rollback-recover':
      return verifyRollbackRecovery();
    case 'snapshot-seed':
      return seedSnapshotProbe();
    case 'snapshot-recover':
      return recoverSnapshotProbe();
  }
}
