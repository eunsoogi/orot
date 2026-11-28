import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '../../i18n';
import type { RecordingPlaybackRange } from '../../recording/recordingTypes';
import {
  original,
  source as mockSource,
} from '../../transcription/testSupport/transcriptEvidenceServiceFixtures';
import { transcriptEvidenceService } from '../../transcription/transcriptEvidenceService';
import { RecordingReviewRoute } from '../RecordingReviewRoute';
let mockFocused = true;
const pending: {
  finish: (receipt: RecordingPlaybackRange) => void;
  fail: (failure: Error) => void;
}[] = [];
const mockPlay = jest.fn(
  (_id: string, _start: number, _end: number) =>
    new Promise<RecordingPlaybackRange>((finish, fail) =>
      pending.push({ finish, fail }),
    ),
);
const mockStop = jest.fn(async () => {});
const segments = [
  { ...original, text: 'Synthetic first audio excerpt.' },
  {
    ...original,
    id: 'synthetic-second-r1',
    transcriptId: 'synthetic-second',
    segmentOrdinal: 1,
    audioRange: { startMs: 2400, endMs: 3900 },
    text: 'Synthetic second audio excerpt.',
  },
];
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
}));
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
      summary: { source: mockSource, durationMs: 5000 },
      autoPlay: false,
    },
  }),
}));
jest.mock('../../recording/useAutomaticRecordingTranscription', () => ({
  useAutomaticRecordingTranscription: () => ({}),
}));
jest.mock('../../recording/recordingService', () => {
  const { createRecordingPlaybackOwner } =
    require('../../recording/recordingPlaybackOwner') as typeof import('../../recording/recordingPlaybackOwner');
  return {
    recordingService: createRecordingPlaybackOwner({
      playRange: (id, start, end) => mockPlay(id, start, end),
      stopPlayback: () => mockStop(),
    }),
  };
});
jest.mock('../../recording/RecordingExportPanel', () => () => null);
jest.mock('../../recording/SavedRecordingDeleteAction', () => ({
  SavedRecordingDeleteAction: () => null,
}));
jest.mock('../../encounterReview/EncounterReviewPanel', () => ({
  EncounterReviewPanel: () => null,
}));
jest.mock('../../transcription/transcriptEvidenceService', () => ({
  transcriptEvidenceService: { load: jest.fn() },
}));
let measuredWidth = 360;
const measurableView = View as unknown as {
  prototype: {
    measureInWindow(
      callback: (x: number, y: number, width: number, height: number) => void,
    ): void;
  };
};
jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    if (this.props.testID === 'recording-review-layout-frame-host')
      callback(20, 0, measuredWidth, 800);
  });

beforeEach(() => {
  mockFocused = true;
  mockPlay.mockClear();
  mockStop.mockClear();
  pending.length = 0;
  jest
    .mocked(transcriptEvidenceService.load)
    .mockResolvedValue({ source: mockSource, segments, staleArtifacts: [] });
});

async function openDetail(width = 360) {
  measuredWidth = width;
  const view = await render(<RecordingReviewRoute />);
  await fireEvent(
    screen.getByTestId('recording-review-layout-frame-host'),
    'layout',
    {
      nativeEvent: { layout: { x: 0, y: 0, width, height: 800 } },
    },
  );
  await fireEvent.press(
    await screen.findByTestId('recording-detail-transcript-toggle'),
  );
  await screen.findByText(segments[0]!.text);
  return view;
}
const row = (ordinal: number) =>
  screen.getByTestId(`transcript-play-${ordinal}`);
const playLabel = t('recording.transcript.play');
const stopLabel = t('recording.library.stopAudio');
// Retain the actual previously mounted JS handler to model delayed delivery.
function capturedPress(ordinal: number): () => void {
  for (let node = row(ordinal).unstable_fiber; node; node = node.return) {
    if (typeof node.memoizedProps?.onPress === 'function')
      return node.memoizedProps.onPress;
  }
  throw new Error('Missing mounted playback action handler');
}
const expectPlaying = (ordinal: number, playing: boolean) =>
  expect(row(ordinal)).toHaveProp(
    'accessibilityLabel',
    playing ? stopLabel : playLabel,
  );
const completed = {
  startMs: 250,
  endMs: 1801,
  actualStartMs: 250,
  completion: 'completed' as const,
};

test.each([360, 1500])(
  'shares the whole player’s circle and stops only the selected equal-range row at %ipx',
  async width => {
    const [first, second] = segments;
    jest.mocked(transcriptEvidenceService.load).mockResolvedValueOnce({
      source: mockSource,
      segments: [first!, { ...second!, audioRange: first!.audioRange }],
      staleArtifacts: [],
    });
    await openDetail(width);
    const whole = screen.getByTestId('recording-playback-button');
    const shape = StyleSheet.flatten(whole.props.style);
    expect(shape).toMatchObject({ width: 44, height: 44 });
    expect(StyleSheet.flatten(row(0).props.style)).toEqual(shape);
    for (const play of [whole, row(0)]) {
      expect(play.props).toMatchObject({
        symbolName: 'play.fill',
        visualScale: 1,
      });
    }
    expect(row(0).props.accessibilityHint).toContain('00:00.250–00:01.801');
    expect(row(1).props.accessibilityHint).toBe(row(0).props.accessibilityHint);
    await fireEvent(row(0), 'glassIconPress');
    expect(mockPlay).toHaveBeenCalledWith(mockSource.id, 250, 1801);
    expectPlaying(0, true);
    expectPlaying(1, false);
    expect(row(0).props).toMatchObject({
      symbolName: 'stop.fill',
      visualScale: 1,
    });
    expect(row(0)).toBeEnabled();
    expect(screen.queryByTestId('transcript-play-range-0')).toBeNull();
    await fireEvent(row(0), 'glassIconPress');
    expect(mockStop).toHaveBeenCalledTimes(1);
    expectPlaying(0, false);
    await act(() =>
      pending[0]!.finish({ ...completed, completion: 'stopped' }),
    );
    expectPlaying(0, false);
  },
);

test('switching ranges ignores the old Stop and terminal response; real end or error clears the current row', async () => {
  await openDetail();
  await fireEvent.press(row(0));
  const oldStop = capturedPress(0);
  await fireEvent.press(row(1));
  expect(mockPlay).toHaveBeenNthCalledWith(2, mockSource.id, 2400, 3900);
  await act(() => oldStop());
  expect(mockStop).not.toHaveBeenCalled();
  await act(() =>
    pending[0]!.fail(new Error('Synthetic previous interruption')),
  );
  expectPlaying(0, false);
  expectPlaying(1, true);
  expect(screen.queryByTestId('transcript-error')).toBeNull();

  await act(() => pending[1]!.finish(completed));
  expectPlaying(1, false);
  await fireEvent.press(row(0));
  await act(() => oldStop());
  expect(mockStop).not.toHaveBeenCalled();
  await act(() =>
    pending[2]!.fail(new Error('Synthetic active source failure')),
  );
  expectPlaying(0, false);
  expect(screen.getByTestId('transcript-error')).toHaveTextContent(
    t('recording.transcript.error.play'),
  );
});

test('whole playback displaces the segment without allowing its old Stop to reach the native player', async () => {
  await openDetail();
  await fireEvent.press(row(0));
  const staleStop = capturedPress(0);
  await fireEvent.press(screen.getByTestId('recording-playback-button'));
  expect(mockPlay).toHaveBeenNthCalledWith(2, mockSource.id, 0, 5000);
  expectPlaying(0, false);
  await act(() => staleStop());
  expect(mockStop).not.toHaveBeenCalled();
  await act(() => pending[0]!.finish({ ...completed, completion: 'stopped' }));
  await fireEvent.press(screen.getByTestId('recording-playback-stop'));
  expect(mockStop).toHaveBeenCalledTimes(1);
  await act(() => pending[1]!.finish(completed));
});

test('focus retirement stops once and does not leave a stale row Stop or surface a late error', async () => {
  const view = await openDetail();
  await fireEvent.press(row(1));
  const staleStop = capturedPress(1);
  mockFocused = false;
  await view.rerender(<RecordingReviewRoute />);
  expect(mockStop).toHaveBeenCalledTimes(1);
  expectPlaying(1, false);
  expect(row(1)).toBeDisabled();
  await act(() => staleStop());
  await act(() =>
    pending[0]!.fail(new Error('Synthetic retired source failure')),
  );
  expect(screen.queryByTestId('transcript-error')).toBeNull();
  mockFocused = true;
  await view.rerender(<RecordingReviewRoute />);
  expectPlaying(1, false);
  expect(row(1)).toBeEnabled();
  expect(mockStop).toHaveBeenCalledTimes(1);
});
