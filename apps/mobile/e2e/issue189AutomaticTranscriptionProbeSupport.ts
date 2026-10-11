import type { SourceRecord } from '@orot/domain';
import { installSyntheticTranscriptionRecording } from '../src/recording/nativeRecordingBridge';
import { saveRecordingSource } from '../src/recording/recordingPersistence';
import { isSyntheticTranscriptionFixtureUnchanged } from '../src/recording/syntheticRecordingExportProbeBridge';
import type {
  RecordingService,
  RecordingSnapshot,
} from '../src/recording/recordingTypes';
import type { RecordingLibraryService } from '../src/recording/recordingLibraryService';
import { openLocalStorage } from '../src/storage/secureDatabase';
import { appleOnDeviceSpeechTranscriptionProvider } from '../src/transcription';
import type { NativeSpeechTranscriptionResponse } from '../src/transcription';
import { createTranscriptEvidenceService } from '../src/transcription/transcriptEvidenceService';
import fixture from './transcription/fixtures/synthetic-korean.json';

export const syntheticTitle =
  'Issue 189 synthetic automatic transcription fixture';

/** Read only this probe's source. Relaunch never starts a new recognition request. */
export async function readAutomaticProbeSource(sourceId: string) {
  const repository = await openLocalStorage();
  const source = await repository.get('source_record', sourceId);
  if (!source || source.title !== syntheticTitle)
    throw new Error('PROBE_SOURCE_MISSING');
  const segments = await repository.transcripts.listForRecording(sourceId);
  return { source, segments };
}

/** The fixture adapter replaces microphone capture and source linking only. */
export async function prepareAutomaticProbe() {
  const sample = fixture.cases[0];
  if (!sample) throw new Error('PROBE_FIXTURE_MISSING');
  const recording = await installSyntheticTranscriptionRecording(
    sample.audio.base64,
  );
  const repository = await openLocalStorage();
  let providerCalls = 0;
  let nativeResult: NativeSpeechTranscriptionResponse | null = null;
  const events: string[] = [];
  async function assertFixture(id: string) {
    if (
      id !== recording.id ||
      !(await isSyntheticTranscriptionFixtureUnchanged(id))
    ) {
      throw new Error('PROBE_FIXTURE_INTEGRITY_FAILED');
    }
  }
  await assertFixture(recording.id);
  // Keep native metadata untouched: a Simulator fixture must not pass production protection checks.
  if (recording.fileProtection === 'complete')
    throw new Error('PROBE_EXPECTED_UNVERIFIED_FILE');
  let rejectionCode = '';
  try {
    await saveRecordingSource(recording);
  } catch (error) {
    rejectionCode = (error as { code?: string }).code ?? 'UNKNOWN';
  }
  const absentSource = !(await repository.get('source_record', recording.id));
  const absentSegments =
    (await repository.transcripts.listForRecording(recording.id)).length === 0;
  if (
    rejectionCode !== 'RECORDING_FILE_PROTECTION_FAILED' ||
    !absentSource ||
    !absentSegments
  ) {
    throw new Error('PROBE_PRODUCTION_REFUSAL_FAILED');
  }
  const refusal = {
    rejectionCode,
    absentSource,
    absentSegments,
    providerCalls,
    fileProtection: recording.fileProtection,
    excludedFromBackup: recording.excludedFromBackup,
  };
  events.push('production-save-refused');
  const transcription = createTranscriptEvidenceService({
    provider: {
      async transcribeRecording(request) {
        await assertFixture(request.recordingId);
        providerCalls += 1;
        events.push('native-provider-start');
        // Forward cancellation unchanged; native code still checks registered fixture integrity.
        const result =
          await appleOnDeviceSpeechTranscriptionProvider.transcribeRecording({
            ...request,
            syntheticFixture: true,
          });
        if (result.ok) nativeResult = result.value;
        events.push(
          result.ok ? 'native-provider-complete' : 'native-provider-failed',
        );
        return result;
      },
    },
  });
  // Avoid listing unrelated sources or invoking deletion reconciliation on a probe screen.
  const library: RecordingLibraryService = {
    async list() {
      const source = await repository.get('source_record', recording.id);
      return source ? [source] : [];
    },
    async deleteRecording() {
      throw new Error('PROBE_DELETION_DISABLED');
    },
  };
  let snapshot: RecordingSnapshot = {
    status: 'idle',
    id: null,
    durationMs: 0,
    consentAcknowledged: false,
  };
  const listeners = new Set<(state: RecordingSnapshot) => void>();
  function publish(status: RecordingSnapshot['status']) {
    snapshot = {
      status,
      id: recording.id,
      durationMs: recording.durationMs,
      consentAcknowledged: status === 'recording' || status === 'paused',
    };
    listeners.forEach(listener => listener(snapshot));
    return snapshot;
  }
  const service: RecordingService = {
    async getState() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async start(consent) {
      if (!consent || snapshot.status !== 'idle')
        throw new Error('PROBE_START_INVALID');
      events.push('screen-start');
      return publish('recording');
    },
    async pause() {
      return publish('paused');
    },
    async resume() {
      return publish('recording');
    },
    async stop() {
      if (snapshot.status !== 'recording' && snapshot.status !== 'paused')
        throw new Error('PROBE_STOP_INVALID');
      await assertFixture(recording.id);
      events.push('screen-stop');
      publish('completed');
      return recording;
    },
    async playRange() {
      throw new Error('PROBE_PLAYBACK_DISABLED');
    },
    async saveSource(value) {
      if (value !== recording || snapshot.status !== 'completed')
        throw new Error('PROBE_SAVE_INVALID');
      await assertFixture(value.id);
      const source: SourceRecord = {
        id: value.id,
        sourceKind: 'audio_recording',
        title: syntheticTitle,
        effectiveAt: value.startedAt,
        recordedAt: value.completedAt,
        ingestedAt: new Date().toISOString(),
        recordingDurationMs: value.durationMs,
        provenance: { origin: 'user_reported', sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' },
      };
      // This is an explicit synthetic source adapter, never evidence of production save acceptance.
      await repository.put('source_record', source);
      events.push('synthetic-source-saved');
      return source;
    },
  };
  return {
    recording,
    refusal,
    service,
    transcription,
    library,
    async report() {
      await assertFixture(recording.id);
      const persisted = await readAutomaticProbeSource(recording.id);
      return {
        ...persisted,
        refusal,
        providerCalls,
        nativeResult,
        events: [...events],
        boundary:
          'synthetic-capture-and-source-save; real-screen-hook-apple-speech-sql',
        fileProtection: recording.fileProtection,
        excludedFromBackup: recording.excludedFromBackup,
      };
    },
  };
}
