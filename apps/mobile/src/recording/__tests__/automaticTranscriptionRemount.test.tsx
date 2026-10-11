import { act, renderHook } from '@testing-library/react-native';
import type { TranscriptEvidenceService } from '../../transcription/transcriptEvidenceService';
import { useAutomaticRecordingTranscription } from '../useAutomaticRecordingTranscription';

function createService() {
  let finish!: () => void;
  const pending = new Promise<[]>(resolve => {
    finish = () => resolve([]);
  });
  const service: TranscriptEvidenceService = {
    transcribe: jest.fn(() => pending),
    load: jest.fn(),
    correct: jest.fn(),
    play: jest.fn(),
  };
  return { service, finish };
}

test('retains the running job across route remount and does not duplicate recognition', async () => {
  const { service, finish } = createService();
  const first = await renderHook(() =>
    useAutomaticRecordingTranscription(service),
  );
  await act(async () => {
    void first.result.current.start('saved-audio');
  });
  await first.unmount();
  const second = await renderHook(() =>
    useAutomaticRecordingTranscription(service),
  );
  expect(second.result.current.state).toEqual({
    sourceId: 'saved-audio',
    status: 'running',
  });
  await act(async () => {
    void second.result.current.start('saved-audio');
  });
  expect(service.transcribe).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(second.result.current.state?.status).toBe('complete');
});

test('deletion from a remounted route cancels the original job and ignores late success', async () => {
  const { service, finish } = createService();
  const first = await renderHook(() =>
    useAutomaticRecordingTranscription(service),
  );
  await act(async () => {
    void first.result.current.start('deleted-audio');
  });
  const signal = jest.mocked(service.transcribe).mock.calls[0][1]!;
  await first.unmount();
  const second = await renderHook(() =>
    useAutomaticRecordingTranscription(service),
  );
  await act(async () => second.result.current.cancel('deleted-audio'));
  expect(signal.aborted).toBe(true);
  await act(async () => finish());
  expect(second.result.current.state).toBeNull();
});
