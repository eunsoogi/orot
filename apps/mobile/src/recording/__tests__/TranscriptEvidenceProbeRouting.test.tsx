import { NativeModules } from 'react-native';
import type { ReactNode } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import RecordingScreen from '../RecordingScreen';
import {
  cleanupSyntheticTranscriptRecording,
  prepareSyntheticTranscriptRecording,
} from '../../../e2e/transcription/transcriptEvidenceProbeSupport';
import { TranscriptEvidenceProbe } from '../../../e2e/transcription/transcriptEvidenceProbe';

jest.mock('../RecordingScreen', () => jest.fn(() => null));
// Native persistence phases prove deletion across processes; these cases isolate screen preparation and cleanup routing.
jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }: { children?: ReactNode }) =>
      React.createElement(View, null, children),
  };
});
jest.mock('../../../e2e/transcription/transcriptEvidenceProbeSupport', () => ({
  createTranscriptEvidenceProbeService: jest.fn(() => ({})),
  prepareSyntheticTranscriptRecording: jest.fn(),
  cleanupSyntheticTranscriptRecording: jest.fn(async () => {}),
}));
const sourceId = '00000000-0000-4000-8000-000000000034';
const nativeModuleValues = NativeModules as unknown as Record<string, unknown>;
const previousSettingsManager = nativeModuleValues.SettingsManager;

beforeEach(() => jest.clearAllMocks());

afterEach(() => {
  Object.defineProperty(NativeModules, 'SettingsManager', {
    configurable: true,
    value: previousSettingsManager,
  });
});

test('the representative UI opens the production screen only after preparing its one recording', async () => {
  let finishPreparation!: (value: { id: string }) => void;
  jest.mocked(prepareSyntheticTranscriptRecording).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishPreparation = resolve as typeof finishPreparation;
      }),
  );
  Object.defineProperty(NativeModules, 'SettingsManager', {
    configurable: true,
    value: { settings: {} },
  });

  render(<TranscriptEvidenceProbe />);
  await waitFor(() =>
    expect(prepareSyntheticTranscriptRecording).toHaveBeenCalledTimes(1),
  );
  expect(RecordingScreen).not.toHaveBeenCalled();
  await act(async () => finishPreparation({ id: sourceId }));
  await waitFor(() => expect(RecordingScreen).toHaveBeenCalled());
  expect(
    screen.getByTestId('transcript-evidence-setup-status'),
  ).toHaveTextContent('ready');
  expect(screen.getByTestId('transcript-evidence-source-id')).toHaveTextContent(
    sourceId,
  );
  expect(prepareSyntheticTranscriptRecording).toHaveBeenCalledTimes(1);
  expect(cleanupSyntheticTranscriptRecording).not.toHaveBeenCalled();
});

test('a failed journey can clean up only its recorded UUID without preparing another source', async () => {
  Object.defineProperty(NativeModules, 'SettingsManager', {
    configurable: true,
    value: { settings: { OROT_TEST_TRANSCRIPT_CLEANUP_ID: sourceId } },
  });
  await act(async () => {
    render(<TranscriptEvidenceProbe />);
  });
  await waitFor(() =>
    expect(cleanupSyntheticTranscriptRecording).toHaveBeenCalledWith(sourceId),
  );
  await waitFor(() =>
    expect(
      screen.getByTestId('transcript-evidence-setup-status'),
    ).toHaveTextContent('cleaned'),
  );
  expect(prepareSyntheticTranscriptRecording).not.toHaveBeenCalled();
  expect(RecordingScreen).not.toHaveBeenCalled();
});
