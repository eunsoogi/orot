import { providerSuccess } from '@orot/model-runtime';
import { createTranscriptEvidenceService } from '../transcriptEvidenceService';
import {
  makeRepository,
  original,
  source,
} from '../testSupport/transcriptEvidenceServiceFixtures';

jest.mock('../index', () => ({
  appleOnDeviceSpeechTranscriptionProvider: { transcribeRecording: jest.fn() },
}));

function successfulResult() {
  return providerSuccess({
    text: original.text,
    language: 'ko-KR',
    segments: [{ text: original.text, startSeconds: 0.25, endSeconds: 1.8 }],
    engine: 'dictation_transcriber' as const,
    runtimeVersion: 'iOS 26.2 (23C54)',
    recordingDurationMs: 5000,
  });
}

describe('transcript evidence service job safety', () => {
  it('coalesces concurrent requests for the same saved recording', async () => {
    const { repository } = makeRepository();
    const provider = {
      transcribeRecording: jest.fn(async () => {
        // Keep the provider pending long enough for a repeated action to join the same job.
        await new Promise(resolve => setTimeout(resolve, 10));
        return successfulResult();
      }),
    };
    const service = createTranscriptEvidenceService({
      loadRepository: async () => repository,
      provider,
    });

    await Promise.all([
      service.transcribe(source.id),
      service.transcribe(source.id),
    ]);
    expect(provider.transcribeRecording).toHaveBeenCalledTimes(1);
  });

  it('does not store results after the saved recording was deleted', async () => {
    const { repository, transcripts } = makeRepository();
    (repository.get as jest.Mock)
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(null);
    const provider = {
      transcribeRecording: jest.fn(async () => successfulResult()),
    };
    const service = createTranscriptEvidenceService({
      loadRepository: async () => repository,
      provider,
    });

    // Deletion can happen while native recognition is running; stale output is discarded.
    await expect(service.transcribe(source.id)).rejects.toThrow();
    expect(transcripts.append).not.toHaveBeenCalled();
  });

  it('does not start native work for an already-canceled request', async () => {
    const { repository, transcripts } = makeRepository();
    const controller = new AbortController();
    controller.abort();
    const provider = { transcribeRecording: jest.fn() };
    const service = createTranscriptEvidenceService({
      loadRepository: async () => repository,
      provider,
    });

    await expect(
      service.transcribe(source.id, controller.signal),
    ).rejects.toThrow();
    expect(provider.transcribeRecording).not.toHaveBeenCalled();
    expect(transcripts.append).not.toHaveBeenCalled();
  });

  it('discards provider output when a running request is canceled', async () => {
    const { repository, transcripts } = makeRepository();
    const controller = new AbortController();
    const response = successfulResult();
    let finishProvider: ((result: typeof response) => void) | undefined;
    const result = new Promise<typeof response>(resolve => {
      finishProvider = resolve;
    });
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    const provider = {
      transcribeRecording: jest.fn(() => {
        markStarted?.();
        return result;
      }),
    };
    const service = createTranscriptEvidenceService({
      loadRepository: async () => repository,
      provider,
    });
    const pending = service.transcribe(source.id, controller.signal);
    await started;
    controller.abort();
    finishProvider?.(response);

    await expect(pending).rejects.toThrow();
    expect(provider.transcribeRecording).toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(transcripts.append).not.toHaveBeenCalled();
  });
});
