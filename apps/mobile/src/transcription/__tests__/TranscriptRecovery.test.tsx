import { fireEvent, render, screen } from '@testing-library/react-native';
import TranscriptEvidencePanel from '../TranscriptEvidencePanel';
import { TranscriptRecognitionError } from '../TranscriptRecognitionError';
import { savedSource } from '../../recording/recordingScreenSupport';
import type { TranscriptEvidenceService } from '../transcriptEvidenceService';

test('explains a denied speech permission without exposing private provider details and keeps retry', async () => {
  const service: TranscriptEvidenceService = {
    load: jest.fn(async () => ({
      source: savedSource,
      segments: [],
      staleArtifacts: [],
    })),
    transcribe: jest.fn(async () => {
      throw new TranscriptRecognitionError({
        code: 'unsupported_capability',
        message: 'PERMISSION_DENIED: private native detail',
        retryable: false,
      });
    }),
    correct: jest.fn(),
    play: jest.fn(),
  };
  await render(
    <TranscriptEvidencePanel
      recordingSourceId={savedSource.id}
      service={service}
    />,
  );
  await fireEvent.press(await screen.findByTestId('transcript-create'));
  expect(await screen.findByTestId('transcript-error')).toHaveTextContent(
    /설정에서.*음성 인식 권한/,
  );
  expect(screen.queryByText(/private native detail/)).toBeNull();
  expect(screen.getByTestId('transcript-create')).toBeEnabled();
});

test('reloads persisted transcription when an automatic job settles on a retained detail route', async () => {
  const service: TranscriptEvidenceService = {
    load: jest.fn(async () => ({
      source: savedSource,
      segments: [],
      staleArtifacts: [],
    })),
    transcribe: jest.fn(),
    correct: jest.fn(),
    play: jest.fn(),
  };
  const view = await render(
    <TranscriptEvidencePanel
      recordingSourceId={savedSource.id}
      service={service}
      automaticTranscriptionStatus="running"
    />,
  );
  expect(screen.queryByTestId('transcript-create')).toBeNull();
  await view.rerender(
    <TranscriptEvidencePanel
      recordingSourceId={savedSource.id}
      service={service}
      automaticTranscriptionStatus="complete"
    />,
  );
  expect(service.load).toHaveBeenCalledTimes(2);
});
