import syntheticFixture from './transcription/fixtures/synthetic-korean.json';
import type { RecordMap } from '@orot/storage';
import {
  installSyntheticTranscriptionRecording,
  removeSyntheticTranscriptionRecording,
} from '../src/recording/nativeRecordingBridge';
import { openLocalStorage } from '../src/storage/secureDatabase';
import { runStorageProbe } from '../src/storage/e2eProbe';
import { runAgentMemoryProbe } from '../src/memory/agentMemoryProbe';
import {
  isDatabaseKeyBackupEligible,
  migrateDatabaseKeyForBackup,
} from '../src/backup/nativeBackupMigration';
import { getBackupProbeRecordingId } from './backupProbeConfig';
import { requireNativeBackupProbe } from './backupProbeNative';
import { createBackupProbeTranscript } from './backupProbeRecording';
import { verifyRecordingProbeState } from './backupProbePreparation';
import type { BackupProbeResult } from './backupProbeTypes';

function logSnapshotProbeStage(stage: string): void {
  // Fixed stage labels help locate a stalled synthetic probe without logging record IDs or paths.
  console.info('Backup snapshot probe stage:', stage);
}

async function persistSnapshotRelationships(recording: {
  id: string;
  startedAt: string;
  completedAt: string;
}): Promise<void> {
  const repository = await openLocalStorage();
  const ingestedAt = new Date().toISOString();
  // This fixture is persisted before capture to distinguish restore from live source ingestion.
  await repository.put('source_record', {
    id: recording.id,
    effectiveAt: recording.startedAt,
    recordedAt: recording.completedAt,
    ingestedAt,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    sourceKind: 'audio_recording',
    title: 'Synthetic snapshot recording',
    contentHash:
      'sha256:' + recording.id.replaceAll('-', '').toLowerCase().repeat(2),
  } satisfies RecordMap['source_record']);
  await repository.transcripts.append([
    createBackupProbeTranscript({ ...recording, durationMs: 1000 }, ingestedAt),
  ]);
}

async function verifySnapshotRelationships(recordingId: string) {
  const repository = await openLocalStorage();
  const source = await repository.sourceRecords.get(recordingId);
  const transcripts =
    await repository.transcripts.listForRecording(recordingId);
  const file =
    await requireNativeBackupProbe().inspectRecordingForBackupProbe(
      recordingId,
    );
  verifyRecordingProbeState(file);
  const transcript = transcripts[0];
  const sourcePersisted =
    source?.sourceKind === 'audio_recording' &&
    source.provenance.origin === 'user_reported';
  const transcriptLinked =
    transcripts.length === 1 &&
    transcript?.recordingSourceId === recordingId &&
    transcript.provenance.origin === 'derived' &&
    transcript.provenance.sourceRecordIds.includes(recordingId);
  if (!sourcePersisted || !transcriptLinked) {
    throw new Error(
      'The restored recording source or transcript relationship is incomplete.',
    );
  }
  return { ...file, sourcePersisted, transcriptLinked };
}

// Persist all required snapshot records before the test copies the app container.
export async function seedSnapshotProbe(): Promise<BackupProbeResult> {
  logSnapshotProbeStage('seed-storage-fresh-start');
  await runStorageProbe('fresh');
  logSnapshotProbeStage('seed-storage-fresh-complete');
  logSnapshotProbeStage('seed-memory-fresh-start');
  await runAgentMemoryProbe('fresh');
  logSnapshotProbeStage('seed-memory-fresh-complete');
  logSnapshotProbeStage('seed-memory-delete-start');
  await runAgentMemoryProbe('delete');
  logSnapshotProbeStage('seed-memory-delete-complete');
  const audio = syntheticFixture.cases[0]?.audio;
  if (!audio)
    throw new Error('The synthetic recording fixture is unavailable.');
  logSnapshotProbeStage('seed-recording-install-start');
  const recording = await installSyntheticTranscriptionRecording(audio.base64);
  logSnapshotProbeStage('seed-recording-install-complete');
  let snapshotReady = false;
  try {
    logSnapshotProbeStage('seed-recording-inspect-start');
    const state =
      await requireNativeBackupProbe().inspectRecordingForBackupProbe(
        recording.id,
      );
    logSnapshotProbeStage('seed-recording-inspect-complete');
    verifyRecordingProbeState(state);
    logSnapshotProbeStage('seed-relationships-persist-start');
    await persistSnapshotRelationships(recording);
    logSnapshotProbeStage('seed-relationships-persist-complete');
    logSnapshotProbeStage('seed-key-eligibility-start');
    const keyEligible = await isDatabaseKeyBackupEligible();
    logSnapshotProbeStage('seed-key-eligibility-complete');
    if (!keyEligible)
      throw new Error('The snapshot database key is not backup eligible.');
    snapshotReady = true;
    logSnapshotProbeStage('seed-complete');
    return {
      evidenceScope: 'synthetic-simulator-app-container-snapshot',
      keyEligible,
      recording: {
        fileProtection: state.fileProtection,
        excludedFromBackup: state.excludedFromBackup,
        strictPreparation: 'not-run-for-snapshot-fixture',
        sourcePersisted: true,
        recordingId: recording.id,
        fileReadable: state.fileReadable,
        transcriptLinked: true,
        sourceFixture: 'pre-existing-synthetic-snapshot-record',
      },
    };
  } finally {
    if (!snapshotReady) {
      logSnapshotProbeStage('seed-recording-cleanup-start');
      await removeSyntheticTranscriptionRecording(recording.id);
      logSnapshotProbeStage('seed-recording-cleanup-complete');
    }
  }
}

// Reopen only after the harness restores the database and permanent recording into a new container.
export async function recoverSnapshotProbe(): Promise<BackupProbeResult> {
  logSnapshotProbeStage('recover-start');
  const recordingId = getBackupProbeRecordingId();
  if (!recordingId)
    throw new Error('The snapshot recording ID is unavailable.');
  // Once its ID is known, cleanup must cover every restore check below.
  try {
    logSnapshotProbeStage('recover-key-migration-start');
    const keyMigration = await migrateDatabaseKeyForBackup();
    logSnapshotProbeStage('recover-key-migration-complete');
    logSnapshotProbeStage('recover-key-eligibility-start');
    const keyEligible = await isDatabaseKeyBackupEligible();
    logSnapshotProbeStage('recover-key-eligibility-complete');
    if (!keyEligible)
      throw new Error('The restored database key is not eligible.');

    logSnapshotProbeStage('recover-storage-restart-start');
    await runStorageProbe('restart');
    logSnapshotProbeStage('recover-storage-restart-complete');
    logSnapshotProbeStage('recover-memory-tombstone-start');
    await runAgentMemoryProbe('tombstone-restart');
    logSnapshotProbeStage('recover-memory-tombstone-complete');
    logSnapshotProbeStage('recover-relationships-verify-start');
    const recording = await verifySnapshotRelationships(recordingId);
    logSnapshotProbeStage('recover-relationships-verify-complete');
    logSnapshotProbeStage('recover-complete');
    return {
      evidenceScope: 'synthetic-simulator-app-container-snapshot',
      keyMigration,
      keyPreserved: true,
      keyEligible,
      storageRelationsReopened: true,
      agentMemoryTombstonePreserved: true,
      recording: {
        fileProtection: recording.fileProtection,
        excludedFromBackup: recording.excludedFromBackup,
        strictPreparation: 'not-run-for-snapshot-fixture',
        sourcePersisted: recording.sourcePersisted,
        recordingId,
        fileReadable: recording.fileReadable,
        transcriptLinked: recording.transcriptLinked,
        sourceFixture: 'pre-existing-synthetic-snapshot-record',
      },
    };
  } finally {
    logSnapshotProbeStage('recover-recording-cleanup-start');
    await removeSyntheticTranscriptionRecording(recordingId);
    logSnapshotProbeStage('recover-recording-cleanup-complete');
  }
}
