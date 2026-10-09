import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  isSyntheticRecordingProbeAvailable,
  prepareSyntheticRecordingStartFailure,
} from '../nativeRecordingBridge';
import RecordingScreen from '../RecordingScreen';
import type {
  CompletedRecording,
  RecordingService,
  RecordingSnapshot,
  RecordingSourceRecord,
} from '../recordingTypes';

jest.mock('../nativeRecordingBridge', () => ({
  nativeRecordingBridge: {},
  isSyntheticRecordingProbeAvailable: jest.fn(() => true),
  prepareSyntheticRecordingProbe: jest.fn(),
  prepareSyntheticRecordingStartFailure: jest.fn(),
  simulateRecordingInterruption: jest.fn(),
}));

const completed: RecordingSnapshot = {
  status: 'completed',
  id: '123e4567-e89b-12d3-a456-426614174000',
  durationMs: 12_500,
  consentAcknowledged: false,
};

const completedRecording: CompletedRecording = {
  id: completed.id ?? '',
  durationMs: 12_500,
  startedAt: '2026-10-04T01:00:00.000Z',
  completedAt: '2026-10-04T01:00:12.500Z',
  fileProtection: 'complete',
  // The synthetic probe records a permanent file, which remains eligible for backup.
  excludedFromBackup: false,
};

const savedSource: RecordingSourceRecord = {
  id: completedRecording.id,
  sourceKind: 'audio_recording',
  effectiveAt: completedRecording.startedAt,
  recordedAt: completedRecording.completedAt,
  ingestedAt: '2026-10-04T02:00:00.000Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
  title: '상담 녹음',
};

const service: RecordingService = {
  getState: jest.fn(async () => completed),
  subscribe: jest.fn(() => jest.fn()),
  start: jest.fn(async () => completed),
  pause: jest.fn(async () => completed),
  resume: jest.fn(async () => completed),
  stop: jest.fn(async (): Promise<CompletedRecording> => completedRecording),
  playRange: jest.fn(
    async (_recordingId: string, startMs: number, endMs: number) => ({
      startMs,
      endMs,
      actualStartMs: startMs,
    }),
  ),
  saveSource: jest.fn(async (): Promise<RecordingSourceRecord> => savedSource),
};

test('offers early and partial-file start failures in the debug Simulator probe', async () => {
  jest.mocked(isSyntheticRecordingProbeAvailable).mockReturnValue(true);
  jest
    .mocked(prepareSyntheticRecordingStartFailure)
    .mockResolvedValue(undefined);
  await render(<RecordingScreen onBack={jest.fn()} service={service} />);

  expect(
    await screen.findByTestId('recording-probe-fail-before-file-url'),
  ).toBeTruthy();
  await fireEvent.press(
    screen.getByTestId('recording-probe-fail-before-file-url'),
  );
  expect(prepareSyntheticRecordingStartFailure).toHaveBeenLastCalledWith(
    'beforeFileURL',
  );
  await fireEvent.press(
    screen.getByTestId('recording-probe-fail-after-file-created'),
  );
  expect(prepareSyntheticRecordingStartFailure).toHaveBeenLastCalledWith(
    'afterFileCreated',
  );
});
