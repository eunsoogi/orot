import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { DailyReportSourceCoverage } from '@orot/domain';
import { DailyReportCoverage } from '../DailyReportCoverage';

jest.mock('../../../layout/AppSymbol', () => ({ AppSymbol: () => null }));

const coverage: DailyReportSourceCoverage[] = [
  {
    source: 'health_observation',
    status: 'available',
    syncStatus: 'complete',
    lastSuccessfulAt: '2026-11-10T03:00:00.000Z',
    availableThrough: '2026-11-10T04:00:00.000Z',
    limitationCodes: [],
  },
  {
    source: 'symptom_entry',
    status: 'empty',
    syncStatus: 'complete',
    lastSuccessfulAt: '2026-11-10T03:00:00.000Z',
    availableThrough: '2026-11-10T04:00:00.000Z',
    limitationCodes: [],
  },
  {
    source: 'dose_event',
    status: 'partial',
    syncStatus: 'retryable',
    lastAttemptAt: '2026-11-10T03:00:00.000Z',
    limitationCodes: ['snapshot_incomplete'],
  },
];

test('shows localized snapshot counts, states and report-timezone freshness', async () => {
  const view = await render(
    <DailyReportCoverage
      coverage={coverage}
      sourceCounts={
        new Map([
          ['health_observation', 2],
          ['symptom_entry', 0],
          ['dose_event', 1],
        ])
      }
      timeZone="Asia/Seoul"
    />,
  );

  expect(
    view.getByLabelText(
      '건강 측정. 확인됨. 불러온 원본 기록 2건. 동기화 완료. 자료 확인 기준: 2026년 11월 10일 13:00',
    ),
  ).toBeTruthy();
  expect(view.getByText('확인된 기록 없음')).toBeTruthy();
  expect(view.getByText('불러온 원본 기록 0건')).toBeTruthy();
  expect(view.getByText('일부만 포함')).toBeTruthy();
  expect(view.getByText('동기화 재시도 필요')).toBeTruthy();
  expect(
    view.queryByText(
      '자료가 많거나 범위가 제한되어 일부 기록만 포함됐을 수 있어요.',
    ),
  ).toBeNull();
});

test('announces unknown sync and freshness separately without relying on color', async () => {
  const view = await render(
    <DailyReportCoverage
      coverage={[
        {
          source: 'health_observation',
          status: 'unknown',
          limitationCodes: ['source_sync_unknown'],
        },
      ]}
      sourceCounts={new Map([['health_observation', 1]])}
      timeZone="Asia/Seoul"
    />,
  );

  expect(
    view.getByLabelText(
      '건강 측정. 자료 확인 상태 미확인. 불러온 원본 기록 1건. 동기화 상태 미확인. 자료 최신 시각 미확인',
    ),
  ).toBeTruthy();
  expect(view.getByText('자료 최신 시각 미확인')).toBeTruthy();
});

test('keeps an unavailable snapshot count unknown instead of showing zero', async () => {
  const view = await render(
    <DailyReportCoverage
      coverage={[
        {
          source: 'health_observation',
          status: 'unknown',
          limitationCodes: [],
        },
      ]}
      timeZone="Asia/Seoul"
    />,
  );

  expect(
    view.getByLabelText(
      '건강 측정. 자료 확인 상태 미확인. 입력 기록 수 미확인. 동기화 상태 미확인. 자료 최신 시각 미확인',
    ),
  ).toBeTruthy();
  expect(view.queryByText('불러온 원본 기록 0건')).toBeNull();
});

test('does not invent record counts or sync times for derived coverage categories', async () => {
  const view = await render(
    <DailyReportCoverage
      coverage={[
        { source: 'calendar', status: 'available', limitationCodes: [] },
      ]}
      sourceCounts={new Map()}
      timeZone="Asia/Seoul"
    />,
  );

  expect(view.getByText('확인됨')).toBeTruthy();
  expect(view.queryByText('불러온 원본 기록 0건')).toBeNull();
  expect(view.queryByText('동기화 상태 미확인')).toBeNull();
  expect(view.queryByText('자료 최신 시각 미확인')).toBeNull();
});

test('reports an absent coverage snapshot as unknown instead of rendering nothing', async () => {
  const view = await render(
    <DailyReportCoverage coverage={[]} timeZone="Asia/Seoul" />,
  );

  expect(view.getByLabelText('입력 자료 범위 미확인')).toBeTruthy();
  expect(view.getByText('입력 자료 범위 미확인')).toBeTruthy();
});

test('reveals limitations and localized check times on demand', async () => {
  const view = await render(
    <DailyReportCoverage
      coverage={coverage}
      sourceCounts={new Map([['dose_event', 1]])}
      timeZone="Asia/Seoul"
    />,
  );

  await fireEvent.press(
    view.getByRole('button', { name: '복약: 제한과 확인 시각 보기' }),
  );
  expect(
    view.getByText(
      '자료가 많거나 범위가 제한되어 일부 기록만 포함됐을 수 있어요.',
    ),
  ).toBeTruthy();
  expect(
    view.getByText('마지막 확인 시도: 2026년 11월 10일 12:00'),
  ).toBeTruthy();
  expect(
    view.getByRole('button', { name: '복약: 제한과 확인 시각 접기' }).props
      .accessibilityState,
  ).toEqual({ expanded: true });
});

test.each([
  ['stale', '최신 상태 확인 필요', 'source_data_stale'],
  ['failed', '확인 실패', 'source_query_failed'],
] as const)(
  'shows the %s state and its named limitation',
  async (status, label, code) => {
    const view = await render(
      <DailyReportCoverage
        coverage={[
          {
            source: 'health_observation',
            status,
            lastAttemptAt:
              status === 'failed' ? '2026-11-10T03:00:00.000Z' : undefined,
            limitationCodes: [code],
          },
        ]}
        sourceCounts={new Map([['health_observation', 1]])}
        timeZone="Asia/Seoul"
      />,
    );

    expect(view.getByText(label)).toBeTruthy();
    await fireEvent.press(
      view.getByRole('button', { name: '건강 측정: 제한과 확인 시각 보기' }),
    );
    expect(view.getAllByText(label)).toHaveLength(2);
  },
);

test('uses wrapping cards without fixed heights for compact windows and large text', async () => {
  const view = await render(
    <DailyReportCoverage
      coverage={[coverage[0]!]}
      sourceCounts={new Map([['health_observation', 2]])}
      timeZone="Asia/Seoul"
    />,
  );

  expect(
    StyleSheet.flatten(
      view.getByTestId('daily-report-coverage-grid').props.style,
    ),
  ).toMatchObject({
    flexDirection: 'row',
    flexWrap: 'wrap',
  });
  const cardStyle = StyleSheet.flatten(
    view.getByTestId('daily-report-coverage-health_observation').props.style,
  );
  expect(cardStyle.minWidth).toBe(150);
  expect(cardStyle.height).toBeUndefined();
});
