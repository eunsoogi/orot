import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import type { RecordingSourceRecord } from '../../recording/recordingTypes';
import type { RecordsRouteProps } from '../RecordsRoute';
import { RecordsRoute } from '../RecordsRoute';

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
    onOpenRecentRecords: jest.fn(),
    onOpenSchedule: jest.fn(),
    recordings: [],
    recordingState: 'ready',
    onRetryRecordings: jest.fn(),
    onOpenSavedRecordings: jest.fn(),
    onOpenRecording: jest.fn(),
    onOpenHealthLibrary: jest.fn(),
    onOpenManualHistory: jest.fn(),
    onOpenGeneratedReports: jest.fn(),
    documentImportService: {
      listDocuments: jest.fn().mockResolvedValue([]),
      getDocument: jest.fn().mockResolvedValue(null),
      selectDocument: jest.fn().mockResolvedValue(null),
      saveDocument: jest.fn().mockResolvedValue('saved'),
      discardDocument: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

test('keeps one primary recording action and every existing Records destination', async () => {
  const routeProps = props();
  await render(<RecordsRoute {...routeProps} />);

  expect(screen.getAllByTestId('records-new-recording')).toHaveLength(1);
  const mine = screen.getByTestId('records-materials');
  const headings = screen.getAllByRole('header');
  expect(
    headings.indexOf(screen.getByRole('header', { name: '최근 기록' })),
  ).toBeLessThan(
    headings.indexOf(within(mine).getByRole('header', { name: '내 자료' })),
  );
  const labels = [
    '일정',
    '저장된 녹음',
    '가져온 건강 기록',
    '기억',
    '대화에서 생성한 자료',
  ];
  expect(
    within(mine)
      .getAllByRole('button')
      .map(row => row.props.accessibilityLabel),
  ).toEqual(labels);
  expect(
    within(mine).getByRole('button', { name: '기억' }).props.accessibilityHint,
  ).toBe('과거 건강 기록과 대화에서 저장한 기억을 확인해요.');
  expect(screen.queryByTestId('records-section-tabs')).toBeNull();
  expect(screen.queryByTestId('saved-memory-browser')).toBeNull();
  expect(screen.queryByTestId('generated-report-browser')).toBeNull();
  expect(screen.getByTestId('records-recent-sources-empty')).toHaveTextContent(
    '아직 최근 기록이 없어요.',
  );
  expect(screen.getByTestId('records-import-medical-document')).toBeTruthy();
  for (const id of [
    'records-new-recording',
    'records-open-schedule',
    'records-open-saved-recordings',
    'records-open-health-library',
    'records-open-memory',
    'records-open-generated-reports',
  ]) {
    await fireEvent.press(screen.getByTestId(id));
  }

  expect(routeProps.onOpenSchedule).toHaveBeenCalledTimes(1);
  expect(routeProps.onOpenRecording).toHaveBeenCalledTimes(1);
  expect(routeProps.onOpenSavedRecordings).toHaveBeenCalledTimes(1);
  expect(routeProps.onOpenManualHistory).toHaveBeenCalledTimes(1);
  expect(routeProps.onOpenGeneratedReports).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('records-open-manual-history')).toBeNull();
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

test('groups actual recent recordings by local day and navigates from the complete timeline', async () => {
  jest.useFakeTimers().setSystemTime(new Date(2026, 10, 2, 12));
  try {
    const recordings = [
      source(
        '123e4567-e89b-12d3-a456-426614174101',
        '오늘 상담',
        new Date(2026, 10, 2, 9, 42).toISOString(),
      ),
      source(
        '123e4567-e89b-12d3-a456-426614174102',
        '오늘 두 번째 상담',
        new Date(2026, 10, 2, 8, 15).toISOString(),
      ),
      source(
        '123e4567-e89b-12d3-a456-426614174103',
        '어제 상담',
        new Date(2026, 10, 1, 20, 27).toISOString(),
      ),
      source(
        '123e4567-e89b-12d3-a456-426614174104',
        '더 오래된 상담',
        new Date(2026, 9, 31, 20, 27).toISOString(),
      ),
    ];
    const routeProps = props({ recordings });
    await render(<RecordsRoute {...routeProps} />);

    expect(screen.getByText('11월 2일 (오늘)')).toBeTruthy();
    expect(screen.getByText('11월 1일 (어제)')).toBeTruthy();
    expect(screen.getByText('오늘 상담', { exact: true })).toBeTruthy();
    expect(screen.getByText('오늘 두 번째 상담', { exact: true })).toBeTruthy();
    expect(screen.getByText('어제 상담', { exact: true })).toBeTruthy();
    expect(screen.queryByText('더 오래된 상담')).toBeNull();

    await fireEvent.press(screen.getByTestId('records-recent-view-all'));
    expect(
      screen.queryByTestId(
        'records-recent-source-123e4567-e89b-12d3-a456-426614174104',
      ),
    ).toBeNull();
    expect(routeProps.onOpenRecentRecords).toHaveBeenCalledTimes(1);
    expect(routeProps.onOpenSavedRecordings).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test('shows loading feedback while the existing recording summary request is pending', async () => {
  await render(<RecordsRoute {...props({ recordingState: 'loading' })} />);

  expect(
    screen.getByTestId('records-recent-sources-loading'),
  ).toHaveTextContent('최근 기록을 불러오는 중…');
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
