import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import type { RecordingSourceRecord } from '../../recording/recordingTypes';
import { RecordsRoute, type RecordsRouteProps } from '../RecordsRoute';

// Layout thresholds are covered by AdaptiveColumns tests; this suite exercises route content and state.
jest.mock('../../layout/AdaptiveColumns', () => {
  const ReactRuntime = require('react') as typeof import('react');
  const { View } = require('react-native') as typeof import('react-native');
  return {
    AdaptiveColumns: ({
      primary,
      secondary,
      testID,
    }: {
      primary: ReactNode;
      secondary?: ReactNode;
      testID?: string;
    }) => ReactRuntime.createElement(View, { testID }, primary, secondary),
  };
});
jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

function source(
  id: string,
  title: string,
  recordedAt: string,
): RecordingSourceRecord {
  return {
    id,
    sourceKind: 'audio_recording',
    effectiveAt: recordedAt,
    recordedAt,
    ingestedAt: recordedAt,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    title,
  };
}

function props(overrides: Partial<RecordsRouteProps> = {}): RecordsRouteProps {
  return {
    recordings: [],
    recordingState: 'ready',
    onRetryRecordings: jest.fn(),
    onOpenSymptoms: jest.fn(),
    onOpenSavedRecordings: jest.fn(),
    onOpenRecording: jest.fn(),
    onOpenHealthLibrary: jest.fn(),
    onOpenManualHistory: jest.fn(),
    ...overrides,
  };
}

test('keeps one primary recording action and every existing Records destination', async () => {
  const routeProps = props();
  await render(<RecordsRoute {...routeProps} />);

  expect(screen.getAllByTestId('records-new-recording')).toHaveLength(1);
  expect(screen.getByTestId('records-new-recording')).toHaveTextContent(
    '새 상담 녹음',
  );
  expect(screen.getByTestId('records-recent-sources-empty')).toHaveTextContent(
    '저장된 녹음이 없어요.',
  );
  expect(screen.getByText('가져온 건강 기록', { exact: true })).toBeTruthy();
  expect(screen.queryByTestId('records-health-import')).toBeNull();
  expect(screen.queryByTestId('records-open-common-observations')).toBeNull();
  expect(screen.queryByTestId('records-open-blood-pressure')).toBeNull();

  await fireEvent.press(screen.getByTestId('records-new-recording'));
  await fireEvent.press(screen.getByTestId('symptoms-open'));
  await fireEvent.press(screen.getByTestId('records-open-saved-recordings'));
  await fireEvent.press(screen.getByTestId('records-open-manual-history'));
  await fireEvent.press(screen.getByTestId('records-open-health-library'));

  expect(routeProps.onOpenRecording).toHaveBeenCalledTimes(1);
  expect(routeProps.onOpenSymptoms).toHaveBeenCalledTimes(1);
  expect(routeProps.onOpenSavedRecordings).toHaveBeenCalledTimes(1);
  expect(routeProps.onOpenManualHistory).toHaveBeenCalledTimes(1);
  expect(routeProps.onOpenHealthLibrary).toHaveBeenCalledTimes(1);
});

test('shows the newest loaded sources and opens their existing saved-recordings destination', async () => {
  const recordings = [
    source(
      '123e4567-e89b-12d3-a456-426614174001',
      '최근 상담',
      '2026-10-25T10:00:00.000Z',
    ),
    source(
      '123e4567-e89b-12d3-a456-426614174002',
      '이전 상담',
      '2026-10-24T10:00:00.000Z',
    ),
    source(
      '123e4567-e89b-12d3-a456-426614174003',
      '세 번째 상담',
      '2026-10-23T10:00:00.000Z',
    ),
    source(
      '123e4567-e89b-12d3-a456-426614174004',
      '더 오래된 상담',
      '2026-10-22T10:00:00.000Z',
    ),
  ];
  const routeProps = props({ recordings });
  await render(<RecordsRoute {...routeProps} />);

  expect(screen.getByText('최근 상담', { exact: true })).toBeTruthy();
  expect(screen.getByText('이전 상담', { exact: true })).toBeTruthy();
  expect(screen.getByText('세 번째 상담', { exact: true })).toBeTruthy();
  expect(
    screen.queryByTestId(
      'records-recent-source-123e4567-e89b-12d3-a456-426614174004',
    ),
  ).toBeNull();

  await fireEvent.press(
    screen.getByTestId(
      'records-recent-source-123e4567-e89b-12d3-a456-426614174001',
    ),
  );
  expect(routeProps.onOpenSavedRecordings).toHaveBeenCalledTimes(1);
});

test('shows loading feedback while the existing recording summary request is pending', async () => {
  await render(<RecordsRoute {...props({ recordingState: 'loading' })} />);

  expect(
    screen.getByTestId('records-recent-sources-loading'),
  ).toHaveTextContent('녹음 목록을 불러오는 중…');
  expect(screen.queryByTestId('records-recent-sources-empty')).toBeNull();
});

test('offers the existing retry action when recording summaries fail to load', async () => {
  const routeProps = props({ recordingState: 'failed' });
  await render(<RecordsRoute {...routeProps} />);

  expect(screen.getByTestId('records-recent-sources-error')).toHaveTextContent(
    '녹음 목록을 불러오지 못했어요.',
  );
  await fireEvent.press(screen.getByTestId('records-recent-sources-retry'));
  expect(routeProps.onRetryRecordings).toHaveBeenCalledTimes(1);
});
