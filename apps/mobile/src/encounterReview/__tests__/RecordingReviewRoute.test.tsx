import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { RecordingReviewRoute } from '../../routes/RecordingReviewRoute';
import { encounterReviewService } from '../service';
import { useNavigationLeaveStateRegistration } from '../../navigation';
import { pending } from '../__fixtures__/pending';
import { reviewCopy } from '../strings';

// Native playback/transcript/export have their own integration suites; render the actual route and review controller here.
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../navigation/NavigationRouteScrollView', () => ({
  NavigationRouteScrollView: ({ children }: { children: ReactNode }) =>
    children,
}));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../recording/RecordingSelectionContext', () => ({
  useRecordingSelection: () => ({
    selection: {
      summary: { source: { id: 'recording-a' }, durationMs: 3000 },
      autoPlay: false,
    },
  }),
}));
jest.mock('../../recording/useAutomaticRecordingTranscription', () => ({
  useAutomaticRecordingTranscription: () => ({}),
}));
jest.mock('../../recording/recordingService', () => ({ recordingService: {} }));
jest.mock('../../transcription/transcriptEvidenceService', () => ({
  transcriptEvidenceService: {},
}));
jest.mock('../../recording/RecordingPlaybackControls', () => () => null);
jest.mock('../../recording/RecordingExportPanel', () => () => null);
jest.mock('../../transcription/TranscriptEvidencePanel', () => () => null);
jest.mock('../../agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: () => ({
    consent: { authorize: jest.fn(async () => 'authorized') },
    disclosureSheet: null,
  }),
}));
jest.mock('../service', () => ({
  encounterReviewService: {
    restore: jest.fn(),
    start: jest.fn(),
    decide: jest.fn(),
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(encounterReviewService.restore)
    .mockResolvedValue({ status: 'pending', pending });
  jest
    .mocked(encounterReviewService.decide)
    .mockResolvedValue({ status: 'saved', recordIds: ['saved'] });
});

test('production recording route restores evidence without extraction and saves only the explicitly edited snapshot', async () => {
  const view = await render(<RecordingReviewRoute />);
  await screen.findByTestId('encounter-save');
  expect(screen.getByText('전사 버전 2')).toBeTruthy();
  expect(screen.getByText('약물')).toBeTruthy();
  expect(screen.getByText('충돌: 기존 기록과 다름')).toBeTruthy();
  expect(encounterReviewService.start).not.toHaveBeenCalled();
  expect(encounterReviewService.decide).not.toHaveBeenCalled();
  await fireEvent.changeText(
    screen.getByTestId('encounter-text-candidate-0'),
    '사용자가 검토한 내용',
  );
  await view.rerender(<RecordingReviewRoute />);
  expect(screen.getByTestId('encounter-text-candidate-0')).toHaveProp(
    'value',
    '사용자가 검토한 내용',
  );
  expect(encounterReviewService.restore).toHaveBeenCalledTimes(1);
  expect(useNavigationLeaveStateRegistration).toHaveBeenLastCalledWith(
    expect.objectContaining({ hasUnsavedChanges: true }),
  );
  await fireEvent.press(screen.getByTestId('encounter-save'));
  await waitFor(() =>
    expect(screen.getByTestId('encounter-status')).toHaveTextContent(
      reviewCopy.saved,
    ),
  );
  expect(encounterReviewService.decide).toHaveBeenCalledWith(
    'recording-a',
    expect.objectContaining({
      pending,
      decision: 'approve',
      candidates: [{ ...pending.candidates[0], text: '사용자가 검토한 내용' }],
    }),
    expect.anything(),
  );
});

test('production route rejection and denied transmission cannot create approval', async () => {
  await render(<RecordingReviewRoute />);
  await screen.findByTestId('encounter-deny');
  jest
    .mocked(encounterReviewService.decide)
    .mockResolvedValue({ status: 'denied' });
  await fireEvent.press(screen.getByTestId('encounter-deny'));
  await waitFor(() =>
    expect(screen.getByTestId('encounter-status')).toHaveTextContent(
      reviewCopy.denied,
    ),
  );
  expect(encounterReviewService.decide).toHaveBeenCalledWith(
    'recording-a',
    expect.objectContaining({ decision: 'deny', candidates: [] }),
    expect.anything(),
  );
  jest
    .mocked(encounterReviewService.start)
    .mockResolvedValue({ status: 'consent-denied' });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('encounter-start'));
  });
  expect(screen.getByTestId('encounter-status')).toHaveTextContent(
    reviewCopy['consent-denied'],
  );
  expect(encounterReviewService.decide).toHaveBeenCalledTimes(1);
});

test('empty extraction stays unsaved and progress survives rerender until explicit cancellation', async () => {
  jest
    .mocked(encounterReviewService.restore)
    .mockResolvedValue({ status: 'idle' });
  let finish!: (value: { status: 'pending'; pending: typeof pending }) => void;
  jest.mocked(encounterReviewService.start).mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const view = await render(<RecordingReviewRoute />);
  await screen.findByTestId('encounter-start');
  await fireEvent.press(screen.getByTestId('encounter-start'));
  await view.rerender(<RecordingReviewRoute />);
  expect(screen.getByTestId('encounter-status')).toHaveTextContent(
    reviewCopy.running,
  );
  expect(encounterReviewService.start).toHaveBeenCalledTimes(1);
  expect(useNavigationLeaveStateRegistration).toHaveBeenLastCalledWith(
    expect.objectContaining({ hasOngoingOperation: true }),
  );
  await fireEvent.press(screen.getByTestId('encounter-cancel'));
  await act(async () => finish({ status: 'pending', pending }));
  expect(screen.getByTestId('encounter-status')).toHaveTextContent(
    reviewCopy.cancelled,
  );
  expect(encounterReviewService.decide).not.toHaveBeenCalled();
  jest.mocked(encounterReviewService.start).mockResolvedValue({
    status: 'pending',
    pending: { ...pending, candidates: [] },
  });
  await fireEvent.press(screen.getByTestId('encounter-start'));
  await waitFor(() =>
    expect(screen.getByTestId('encounter-status')).toHaveTextContent(
      reviewCopy.empty,
    ),
  );
  expect(screen.getByTestId('encounter-save')).toBeDisabled();
});
