import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useNavigationLeaveStateRegistration } from '../../navigation';
import { pending } from '../../encounterReview/__fixtures__/pending';
import { encounterReviewService } from '../../encounterReview/service';
import {
  original,
  source as recordingSource,
} from '../../transcription/testSupport/transcriptEvidenceServiceFixtures';
import {
  transcriptEvidenceService,
  type TranscriptRecordingView,
} from '../../transcription/transcriptEvidenceService';
import { RecordingReviewRoute } from '../RecordingReviewRoute';

const selectedSource = { ...recordingSource, id: 'recording-a' };
const selectedSegment = {
  ...original,
  id: 'recording-a:segment:0:r1',
  transcriptId: 'recording-a:segment:0',
  recordingSourceId: selectedSource.id,
  provenance: {
    ...original.provenance,
    sourceRecordIds: [selectedSource.id],
  },
};
const transcriptView: TranscriptRecordingView = {
  source: selectedSource,
  segments: [selectedSegment],
  staleArtifacts: [],
};

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
jest.mock('../../recording/RecordingPlaybackControls', () => {
  const ReactRuntime = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: () =>
      ReactRuntime.createElement(NativeView, {
        testID: 'recording-playback-controls',
      }),
  };
});
jest.mock('../../recording/RecordingExportPanel', () => {
  const ReactRuntime = require('react') as typeof import('react');
  const { View: NativeView } =
    require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: () =>
      ReactRuntime.createElement(NativeView, {
        testID: 'recording-export-panel',
      }),
  };
});
jest.mock('../../transcription/transcriptEvidenceService', () => ({
  transcriptEvidenceService: {
    load: jest.fn(),
    transcribe: jest.fn(),
    correct: jest.fn(),
    play: jest.fn(),
  },
}));
jest.mock('../../agent/execution/useInferenceConsent', () => ({
  useInferenceConsent: () => ({
    consent: { authorize: jest.fn(async () => 'authorized') },
    disclosureSheet: null,
  }),
}));
jest.mock('../../encounterReview/service', () => ({
  encounterReviewService: {
    restore: jest.fn(),
    start: jest.fn(),
    decide: jest.fn(),
  },
}));

const measuredBounds = new Map<
  string,
  { readonly x: number; readonly width: number }
>();
const measurableView = View as unknown as {
  prototype: {
    measureInWindow: (
      callback: (x: number, y: number, width: number, height: number) => void,
    ) => void;
  };
};

jest
  .spyOn(measurableView.prototype, 'measureInWindow')
  .mockImplementation(function (
    this: { readonly props: { readonly testID?: string } },
    callback,
  ) {
    const bounds = measuredBounds.get(this.props.testID ?? '');
    if (bounds) callback(bounds.x, 0, bounds.width, 800);
  });

beforeEach(() => {
  jest.clearAllMocks();
  measuredBounds.clear();
  jest.mocked(transcriptEvidenceService.load).mockResolvedValue(transcriptView);
  jest
    .mocked(transcriptEvidenceService.transcribe)
    .mockResolvedValue([selectedSegment]);
  jest
    .mocked(transcriptEvidenceService.correct)
    .mockResolvedValue(selectedSegment);
  jest
    .mocked(encounterReviewService.restore)
    .mockResolvedValue({ status: 'pending', pending });
  jest
    .mocked(encounterReviewService.decide)
    .mockResolvedValue({ status: 'saved', recordIds: ['saved'] });
});

function layoutAxis(): string | undefined {
  return StyleSheet.flatten(
    screen.getByTestId('recording-review-layout').props.style,
  )?.flexDirection;
}

async function setMeasuredHostWidth(width: number): Promise<void> {
  const testID = 'recording-review-layout-host';
  measuredBounds.set(testID, { x: 20, width });
  // Exercise the same measurement callback used by native window geometry and Split View.
  await fireEvent(screen.getByTestId(testID), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width, height: 800 } },
  });
}

/** Reflow must keep the recording transcript and encounter review drafts in their mounted route panels. */
test('reflows source and review panels without losing edits, selection, or request ownership', async () => {
  await render(<RecordingReviewRoute reviewService={encounterReviewService} />);
  await screen.findByTestId('transcript-text-0');
  await screen.findByTestId('encounter-save');

  expect(layoutAxis()).toBe('column');
  await fireEvent.press(screen.getByTestId('encounter-select-candidate-0'));
  await fireEvent.changeText(
    screen.getByTestId('encounter-text-candidate-0'),
    '검토 후보 초안',
  );
  await fireEvent.press(screen.getByTestId('transcript-edit-0'));
  await fireEvent.changeText(
    screen.getByTestId('transcript-input-0'),
    '전사 수정 초안',
  );

  await setMeasuredHostWidth(1500);
  expect(layoutAxis()).toBe('row');
  expect(
    within(screen.getByTestId('recording-review-layout-primary')).getByTestId(
      'recording-playback-controls',
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId('recording-review-layout-primary')).getByTestId(
      'transcript-panel',
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId('recording-review-layout-secondary')).getByTestId(
      'encounter-review-panel',
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId('recording-review-layout-secondary')).getByTestId(
      'recording-export-panel',
    ),
  ).toBeTruthy();
  expect(screen.getByTestId('transcript-input-0').props.value).toBe(
    '전사 수정 초안',
  );
  expect(screen.getByTestId('encounter-text-candidate-0').props.value).toBe(
    '검토 후보 초안',
  );
  expect(
    screen.getByTestId('encounter-select-candidate-0').props.accessibilityState
      .selected,
  ).toBe(false);

  await setMeasuredHostWidth(500);
  expect(layoutAxis()).toBe('column');
  expect(screen.getByTestId('transcript-input-0').props.value).toBe(
    '전사 수정 초안',
  );
  expect(screen.getByTestId('encounter-text-candidate-0').props.value).toBe(
    '검토 후보 초안',
  );
  expect(transcriptEvidenceService.load).toHaveBeenCalledTimes(1);
  expect(encounterReviewService.restore).toHaveBeenCalledTimes(1);
  expect(encounterReviewService.start).not.toHaveBeenCalled();
  expect(useNavigationLeaveStateRegistration).toHaveBeenLastCalledWith(
    expect.objectContaining({ hasUnsavedChanges: true }),
  );
});
