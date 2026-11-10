import { providerSuccess } from '@orot/model-runtime';
import {
  bindRecordingToVisit,
  createVisitQuestionRecordRepository,
  loadCurrentRecapInput,
  readCurrentRecapResult,
} from '@orot/storage';
import {
  openLocalAgentMemoryDatabase,
  openLocalStorage,
} from '../../src/storage/secureDatabase';
import { createAutomaticRecapService } from '../../src/transcription/automaticRecapService';
import { createTranscriptEvidenceService } from '../../src/transcription/transcriptEvidenceService';
import {
  cleanupSyntheticTranscriptRecording,
  prepareSyntheticTranscriptRecording,
} from './transcriptEvidenceProbeSupport';
import {
  createAutomaticRecapSyntheticProvider,
  syntheticRecapQuestion,
  syntheticRecapTranscript,
} from './automaticRecapSyntheticProvider';

const validSource =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const visitId = (source: string) => `synthetic-recap-visit:${source}`;
const questionId = (source: string) => `synthetic-recap-question:${source}`;

/** Only fixture-owned UUIDs may address or delete data in this operation. */
function sourceId(value: unknown): string {
  if (typeof value !== 'string' || !validSource.test(value))
    throw new Error('An exact synthetic recording UUID is required.');
  return value;
}

/** Read durable records independently of the transcription and model callbacks. */
async function report(source: string) {
  const database = await openLocalAgentMemoryDatabase();
  const result = await readCurrentRecapResult(database, source);
  const records = await createVisitQuestionRecordRepository(
    database,
  ).listForAppointment(visitId(source));
  const binding = await database.execute(
    'SELECT work_status FROM recap_bindings WHERE recording_id = ? AND appointment_id = ?',
    [source, visitId(source)],
  );
  const saved = await database.execute(
    'SELECT saved FROM recap_results WHERE recording_id = ?',
    [source],
  );
  if (
    !result ||
    binding.rows[0]?.work_status !== 'saved' ||
    saved.rows[0]?.saved !== 1 ||
    records.length !== 1
  )
    throw new Error('The validated official Recap has not been committed.');
  return { sourceId: source, result, records };
}

/** Synthetic speech/model output drive the shipping transcript and automatic-save services with SQLCipher. */
export async function seedAutomaticRecapPersistence() {
  const recording = await prepareSyntheticTranscriptRecording();
  const source = sourceId(recording.id);
  if (recording.durationMs < 1801)
    throw new Error('Synthetic audio is too short.');
  const repository = await openLocalStorage();
  const database = await openLocalAgentMemoryDatabase();
  const time = '2035-01-02T00:00:00Z';
  const metadata = {
    effectiveAt: time,
    recordedAt: time,
    ingestedAt: time,
    provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' as const },
  };
  await repository.put('appointment', {
    ...metadata,
    id: visitId(source),
    status: 'scheduled',
  });
  await repository.put('visit_question', {
    ...metadata,
    id: questionId(source),
    appointmentId: visitId(source),
    questionText: syntheticRecapQuestion,
    priority: 'routine',
    evidenceSpanIds: [],
  });
  await bindRecordingToVisit(database, source, visitId(source));
  let modelCalls = 0;
  let speechCalls = 0;
  const run = createAutomaticRecapService(
    database,
    { authorize: async () => 'authorized' },
    async () => {
      const input = await loadCurrentRecapInput(database, source);
      if (!input) throw new Error('Synthetic Recap input is missing.');
      const scripted = createAutomaticRecapSyntheticProvider(input);
      const provider = {
        ...scripted.provider,
        async generate(...args: Parameters<typeof scripted.provider.generate>) {
          modelCalls += 1;
          return scripted.provider.generate(...args);
        },
      };
      const selection = { providerId: provider.id, modelId: 'synthetic-model' };
      return {
        status: 'ready',
        selection,
        provider,
        modelId: selection.modelId,
        option: {
          provider,
          modelId: selection.modelId,
          displayName: provider.displayName,
          privacyBoundary: 'on-device',
          availability: { status: 'available' },
        },
        recipient: 'synthetic',
        remoteProcessing: false,
      };
    },
  );
  let resolveCompletion!: (value: Awaited<ReturnType<typeof run>>) => void;
  let rejectCompletion!: (error: unknown) => void;
  const completion = new Promise<Awaited<ReturnType<typeof run>>>(
    (resolve, reject) => {
      resolveCompletion = resolve;
      rejectCompletion = reject;
    },
  );
  const service = createTranscriptEvidenceService({
    provider: {
      async transcribeRecording(request) {
        if (request.recordingId !== source)
          throw new Error('Unexpected recording.');
        speechCalls += 1;
        return providerSuccess({
          text: syntheticRecapTranscript,
          language: 'ko-KR',
          segments: [
            {
              text: syntheticRecapTranscript,
              startSeconds: 0.25,
              endSeconds: 1.8,
            },
          ],
          engine: 'dictation_transcriber' as const,
          runtimeVersion: 'synthetic-fixture',
          recordingDurationMs: recording.durationMs,
        });
      },
    },
    onTranscribed: async (id, segments, signal) => {
      try {
        resolveCompletion(await run(id, segments, signal));
      } catch (error) {
        rejectCompletion(error);
      }
    },
  });
  const segments = await service.transcribe(source);
  const outcome = await completion;
  if (
    outcome.status !== 'saved' ||
    speechCalls !== 1 ||
    modelCalls !== 1 ||
    segments.length !== 1
  )
    throw new Error(
      'Synthetic transcription did not automatically produce one saved Recap.',
    );
  return {
    ...(await report(source)),
    speechCalls,
    modelCalls,
    recognition: 'synthetic',
    model: 'synthetic',
  };
}

/** Host compares this report with the seed receipt in a distinct app process before cleanup. */
export async function readAutomaticRecapPersistence(value: unknown) {
  return report(sourceId(value));
}

/** Delete only the exact fixture and its own visit after its readback is preserved. */
export async function cleanupAutomaticRecapPersistence(value: unknown) {
  const source = sourceId(value);
  const repository = await openLocalStorage();
  if (
    !(await repository.get('appointment', visitId(source))) ||
    !(await repository.get('visit_question', questionId(source)))
  )
    throw new Error(
      'Synthetic ownership records are missing; refusing cleanup.',
    );
  await cleanupSyntheticTranscriptRecording(source);
  await repository.delete('visit_question', questionId(source));
  await repository.delete('appointment', visitId(source));
  return { cleaned: true, sourceId: source };
}
