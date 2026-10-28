import type { TranscriptEvidenceSegment } from '@orot/domain';
import { prepareRecordingDeletionWorkload } from '../../../e2e/transcription/recordingDeletionWorkload';
import { prepareSyntheticTranscriptRecording } from '../../../e2e/transcription/transcriptEvidenceProbeSupport';

jest.mock('../../../e2e/transcription/transcriptEvidenceProbeSupport', () => ({
  prepareSyntheticTranscriptRecording: jest.fn(async () => ({
    id: 'synthetic-source',
  })),
}));

beforeEach(() => jest.clearAllMocks());

test('audio-only comparison does not seed transcript or memory fanout', async () => {
  const transcribe = jest.fn();
  await expect(
    prepareRecordingDeletionWorkload('audio-only', { transcribe }),
  ).resolves.toEqual({ id: 'synthetic-source' });
  expect(transcribe).not.toHaveBeenCalled();
});

test('transcribed comparison waits for persisted evidence before exposing the recording', async () => {
  let release: ((value: TranscriptEvidenceSegment[]) => void) | undefined;
  const transcribe = jest.fn(
    () =>
      new Promise<TranscriptEvidenceSegment[]>(resolve => {
        release = resolve;
      }),
  );
  const operation = prepareRecordingDeletionWorkload('transcribed-evidence', {
    transcribe,
  });
  let ready = false;
  operation.then(
    () => {
      ready = true;
    },
    () => {},
  );
  await Promise.resolve();
  expect(transcribe).toHaveBeenCalledWith('synthetic-source');
  expect(ready).toBe(false);
  release?.([{} as TranscriptEvidenceSegment]);
  await expect(operation).resolves.toEqual({ id: 'synthetic-source' });
  expect(ready).toBe(true);
});

test('unsupported conditions fail before seeding and missing evidence never becomes ready', async () => {
  const transcribe = jest.fn(async () => []);
  await expect(
    prepareRecordingDeletionWorkload('scaled-delay', { transcribe }),
  ).rejects.toThrow('Unsupported');
  expect(prepareSyntheticTranscriptRecording).not.toHaveBeenCalled();
  await expect(
    prepareRecordingDeletionWorkload('transcribed-evidence', { transcribe }),
  ).rejects.toThrow('Expected one');
});
