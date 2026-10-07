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
import {
  createBackupProbeTranscript,
  verifyRecordingProbeState,
} from './backupProbeRecording';
import type { BackupProbeResult } from './backupProbeTypes';

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
  await runStorageProbe('fresh');
  await runAgentMemoryProbe('fresh');
  await runAgentMemoryProbe('delete');
  const audio = syntheticFixture.cases[0]?.audio;
  if (!audio)
    throw new Error('The synthetic recording fixture is unavailable.');
  const recording = await installSyntheticTranscriptionRecording(audio.base64);
  let snapshotReady = false;
  try {
    const state =
      await requireNativeBackupProbe().inspectRecordingForBackupProbe(
        recording.id,
      );
    verifyRecordingProbeState(state);
    await persistSnapshotRelationships(recording);
    const keyEligible = await isDatabaseKeyBackupEligible();
    if (!keyEligible)
      throw new Error('The snapshot database key is not backup eligible.');
    snapshotReady = true;
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
    if (!snapshotReady)
      await removeSyntheticTranscriptionRecording(recording.id);
  }
}

// Reopen only after the harness restores the database and permanent recording into a new container.
export async function recoverSnapshotProbe(): Promise<BackupProbeResult> {
  const recordingId = getBackupProbeRecordingId();
  if (!recordingId)
    throw new Error('The snapshot recording ID is unavailable.');
  const keyMigration = await migrateDatabaseKeyForBackup();
  const keyEligible = await isDatabaseKeyBackupEligible();
  if (!keyEligible)
    throw new Error('The restored database key is not eligible.');

  await runStorageProbe('restart');
  await runAgentMemoryProbe('tombstone-restart');
  const recording = await verifySnapshotRelationships(recordingId);
  try {
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
    await removeSyntheticTranscriptionRecording(recordingId);
  }
}
