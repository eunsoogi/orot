import { NativeModules } from 'react-native';
import type { ReactNode } from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import RecordingScreen from '../RecordingScreen';
import {
  cleanupSyntheticTranscriptRecording,
  prepareSyntheticTranscriptRecording,
} from '../../../e2e/transcription/transcriptEvidenceProbeSupport';
import {
  seedTranscriptDeletionEvidence,
  verifyTranscriptDeletionAfterRelaunch,
} from '../../../e2e/transcription/transcriptDeletionProbeSupport';
import { TranscriptEvidenceProbe } from '../../../e2e/transcription/transcriptEvidenceProbe';

jest.mock('../RecordingScreen', () => jest.fn(() => null));
// The native journey proves inset geometry; this unit case exercises relaunch routing with fixed insets.
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
jest.mock('../../../e2e/transcription/transcriptDeletionProbeSupport', () => ({
  seedTranscriptDeletionEvidence: jest.fn(),
  verifyTranscriptDeletionAfterRelaunch: jest.fn(async () => {}),
}));

const sourceId = '00000000-0000-4000-8000-000000000034';
const nativeModuleValues = NativeModules as unknown as Record<string, unknown>;
const previousSettingsManager = nativeModuleValues.SettingsManager;

afterEach(() => {
  Object.defineProperty(NativeModules, 'SettingsManager', {
    configurable: true,
    value: previousSettingsManager,
  });
});

test('relaunch verification opens the production screen without reseeding the deleted recording', async () => {
  Object.defineProperty(NativeModules, 'SettingsManager', {
    configurable: true,
    value: {
      settings: { OROT_TRANSCRIPT_DELETION_VERIFY_SOURCE_ID: sourceId },
    },
  });

  render(<TranscriptEvidenceProbe />);

  await waitFor(() => expect(RecordingScreen).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      screen.getByTestId('transcript-evidence-deletion-status'),
    ).toHaveTextContent('passed'),
  );
  expect(verifyTranscriptDeletionAfterRelaunch).toHaveBeenCalledWith(sourceId);
  expect(seedTranscriptDeletionEvidence).not.toHaveBeenCalled();
  expect(prepareSyntheticTranscriptRecording).not.toHaveBeenCalled();
});

test('a failed journey can clean up only its recorded UUID without preparing another source', async () => {
  Object.defineProperty(NativeModules, 'SettingsManager', {
    configurable: true,
    value: { settings: { OROT_TEST_TRANSCRIPT_CLEANUP_ID: sourceId } },
  });
  render(<TranscriptEvidenceProbe />);
  await waitFor(() =>
    expect(cleanupSyntheticTranscriptRecording).toHaveBeenCalledWith(sourceId),
  );
  await waitFor(() =>
    expect(
      screen.getByTestId('transcript-evidence-setup-status'),
    ).toHaveTextContent('cleaned'),
  );
  expect(prepareSyntheticTranscriptRecording).not.toHaveBeenCalled();
});
