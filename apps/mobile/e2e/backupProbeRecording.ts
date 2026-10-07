import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import {
  isDatabaseKeyBackupEligible,
  migrateDatabaseKeyForBackup,
} from '../src/backup/nativeBackupMigration';
import { runAgentMemoryProbe } from '../src/memory/agentMemoryProbe';
import {
  installSyntheticTranscriptionRecording,
  removeSyntheticTranscriptionRecording,
} from '../src/recording/nativeRecordingBridge';
import { saveRecordingSource } from '../src/recording/recordingPersistence';
import { openLocalStorage } from '../src/storage/secureDatabase';
import { runStorageProbe } from '../src/storage/e2eProbe';
import syntheticFixture from './transcription/fixtures/synthetic-korean.json';
import { requireNativeBackupProbe } from './backupProbeNative';
import type {
  BackupProbeResult,
  RecordingProbeState,
} from './backupProbeTypes';

const databaseKeyService = 'com.orot.mobile.database-encryption-key.v1';
const databaseKeyAccount = 'database';

async function readDatabaseKey() {
  const credentials = await getGenericPassword({ service: databaseKeyService });
  if (credentials === false || credentials.username !== databaseKeyAccount) {
    throw new Error('The synthetic database key is unavailable.');
  }
  return credentials;
}

// Force a one-shot native readback miss after updating an existing device-only key.
export async function runKeyRollbackProbe(): Promise<BackupProbeResult> {
  await runStorageProbe('fresh');
  await runAgentMemoryProbe('fresh');
  await runAgentMemoryProbe('delete');
  const original = await readDatabaseKey();
  const saved = await setGenericPassword(
    databaseKeyAccount,
    original.password,
    {
      service: databaseKeyService,
      accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    },
  );
  if (saved === false)
    throw new Error('The device-only rollback fixture was not saved.');

  const probe = requireNativeBackupProbe();
  if ((await probe.backupKeyAccessibilityForProbe()) !== 'this-device-only') {
    throw new Error('The rollback probe did not start from a device-only key.');
  }
  if (!(await probe.armPostUpdateReadbackFailureForProbe())) {
    throw new Error('The post-update readback failure was not armed.');
  }

  let migrationRejected = false;
  try {
    await migrateDatabaseKeyForBackup();
  } catch {
    migrationRejected = true;
  }
  const after = await readDatabaseKey();
  const afterAccessibility = await probe.backupKeyAccessibilityForProbe();
  const readbackFailureWasTriggered =
    await probe.postUpdateReadbackFailureWasTriggeredForProbe();
  const keyEligible = await isDatabaseKeyBackupEligible();
  if (
    !migrationRejected ||
    !readbackFailureWasTriggered ||
    after.password !== original.password ||
    afterAccessibility !== 'this-device-only' ||
    keyEligible
  ) {
    throw new Error(
      'A failed migration did not restore the same device-only key.',
    );
  }
  return {
    evidenceScope: 'synthetic-simulator-process-restart',
    keyPreserved: true,
    keyEligible,
    rollbackVerified: true,
    keyAccessibility: afterAccessibility,
  };
}

// Reopen storage after process restart to verify the rollback kept its original key usable.
export async function verifyRollbackRecovery(): Promise<BackupProbeResult> {
  const keyMigration = await migrateDatabaseKeyForBackup();
  await runStorageProbe('restart');
  await runAgentMemoryProbe('tombstone-restart');
  const keyEligible = await isDatabaseKeyBackupEligible();
  if (!keyEligible)
    throw new Error('Storage did not recover after the key rollback.');
  return {
    evidenceScope: 'synthetic-simulator-process-restart',
    keyMigration,
    keyPreserved: true,
    keyEligible,
    storageRelationsReopened: true,
  };
}

export function createBackupProbeTranscript(
  recording: {
    id: string;
    durationMs: number;
    startedAt: string;
    completedAt: string;
  },
  ingestedAt: string,
) {
  const transcriptId = `backup-probe-transcript-${recording.id}`;
  const audioEndMs = Math.max(1, Math.min(1000, recording.durationMs));
  return {
    id: `${transcriptId}:r1`,
    transcriptId,
    recordingSourceId: recording.id,
    segmentOrdinal: 0,
    revision: 1,
    text: 'Synthetic backup transcript segment.',
    language: 'en-US',
    recordingDurationMs: recording.durationMs,
    audioRange: { startMs: 0, endMs: audioEndMs },
    effectiveAt: recording.startedAt,
    recordedAt: recording.completedAt,
    ingestedAt,
    provenance: {
      origin: 'derived' as const,
      sourceRecordIds: [recording.id],
      source: {
        system: 'Synthetic backup probe',
        sourceIdentifier: 'fixture-transcriber',
        sourceVersion: '1',
      },
    },
    reviewState: { status: 'unreviewed' as const },
  };
}

export function verifyRecordingProbeState(state: RecordingProbeState): void {
  if (!state.fileReadable || state.excludedFromBackup) {
    throw new Error(
      'The synthetic recording is unreadable or backup-excluded.',
    );
  }
}

export async function prepareLegacyRecording(): Promise<BackupProbeResult> {
  const audio = syntheticFixture.cases[0]?.audio;
  if (!audio)
    throw new Error('The synthetic recording fixture is unavailable.');
  const recording = await installSyntheticTranscriptionRecording(audio.base64);
  try {
    const migrated =
      await requireNativeBackupProbe().prepareLegacyRecordingForBackupProbe(
        recording.id,
      );
    verifyRecordingProbeState(migrated);
    if (!migrated.legacyExcludedBefore) {
      throw new Error('The legacy recording did not start backup-excluded.');
    }

    let sourcePersisted = false;
    let transcriptLinked = false;
    if (migrated.fileProtection === 'complete' && migrated.preparationReady) {
      const verifiedRecording = {
        ...recording,
        fileProtection: 'complete' as const,
        excludedFromBackup: migrated.excludedFromBackup,
      };
      const source = await saveRecordingSource(verifiedRecording);
      const repository = await openLocalStorage();
      await repository.transcripts.append([
        createBackupProbeTranscript(
          verifiedRecording,
          new Date().toISOString(),
        ),
      ]);
      const storedSource = await repository.sourceRecords.get(recording.id);
      const transcripts = await repository.transcripts.listForRecording(
        recording.id,
      );
      sourcePersisted =
        source.id === recording.id &&
        storedSource?.sourceKind === 'audio_recording' &&
        storedSource.provenance.origin === 'user_reported';
      transcriptLinked =
        transcripts.length === 1 &&
        transcripts[0]?.recordingSourceId === recording.id &&
        transcripts[0].provenance.sourceRecordIds.includes(recording.id);
      if (!sourcePersisted || !transcriptLinked) {
        throw new Error(
          'The prepared recording source or transcript was not persisted.',
        );
      }
    } else {
      let persistenceRejected = false;
      try {
        await saveRecordingSource({
          ...recording,
          fileProtection: 'unverified',
          excludedFromBackup: migrated.excludedFromBackup,
        });
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
      if (
        migrated.fileProtection === 'complete' ||
        !persistenceRejected ||
        sourcePersisted
      ) {
        throw new Error(
          'An unverified recording source bypassed the fail-closed persistence gate.',
        );
      }
    }

    return {
      evidenceScope: 'synthetic-simulator-process-restart',
      recording: {
        fileProtection: migrated.fileProtection,
        excludedFromBackup: migrated.excludedFromBackup,
        strictPreparation: migrated.preparationReady ? 'ready' : 'not-ready',
        sourcePersisted,
        recordingId: recording.id,
        legacyExcludedBefore: migrated.legacyExcludedBefore,
        preparedCount: migrated.preparedCount,
        preparationError: migrated.preparationError,
        preparationReady: migrated.preparationReady,
        fileReadable: migrated.fileReadable,
        transcriptLinked,
      },
    };
  } finally {
    await removeSyntheticTranscriptionRecording(recording.id);
  }
}
