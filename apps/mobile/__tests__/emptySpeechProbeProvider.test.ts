jest.mock('../src/transcription', () => ({
  appleOnDeviceSpeechTranscriptionProvider: { transcribeRecording: jest.fn() },
}));

import { appleOnDeviceSpeechTranscriptionProvider } from '../src/transcription';
import { automaticProbeProvider } from '../e2e/transcription/emptySpeechProbeProvider';

test('keeps the original native provider unless the empty-result fixture is selected', () => {
  expect(automaticProbeProvider(false)).toBe(
    appleOnDeviceSpeechTranscriptionProvider,
  );
});

test('returns a labeled empty result without calling the real speech provider', async () => {
  await expect(
    automaticProbeProvider(true).transcribeRecording({
      recordingId: 'synthetic-source',
      language: 'ko-KR',
    }),
  ).resolves.toMatchObject({
    ok: true,
    value: { text: '', segments: [], runtimeVersion: 'synthetic-empty-result' },
  });
  expect(
    appleOnDeviceSpeechTranscriptionProvider.transcribeRecording,
  ).not.toHaveBeenCalled();
});
