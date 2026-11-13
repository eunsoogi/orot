import { act, render, screen } from '@testing-library/react-native';
import { createDailyReportIdentity } from '@orot/domain';
import { notifyLocalSourceDeleted } from '../../../storage/localDataClearEvents';
import { DailyReportRoute } from '../DailyReportRoute';
import type { createDailyReportFeature } from '../dailyReportFeature';

test('hides a saved report immediately after a cited source is deleted', async () => {
  const identity = createDailyReportIdentity('2023-11-15', 'Asia/Seoul');
  const lookup = jest
    .fn()
    .mockResolvedValueOnce({
      status: 'saved',
      runId: 'run',
      revision: 1,
      context: {
        identity,
        generationCutoff: '2023-11-15T12:00:00Z',
        sourceSnapshot: {
          records: [
            {
              source: 'health_observation',
              recordId: 'synthetic-health-record',
              revision: 'synthetic-revision',
              occurrence: { startInclusive: '2023-11-15T10:00:00Z' },
              ingestedAt: '2023-11-15T10:00:00Z',
            },
          ],
        },
      },
      report: {
        generatedAt: '2023-11-15T12:01:00Z',
        observations: [{ text: '합성 기록' }],
        supportedContext: [],
        followUpQuestions: [],
        coverage: [
          {
            source: 'health_observation',
            status: 'available',
            syncStatus: 'complete',
            lastSuccessfulAt: '2023-11-15T11:00:00Z',
            availableThrough: '2023-11-15T11:00:00Z',
            limitationCodes: [],
          },
        ],
      },
    })
    .mockResolvedValue({
      status: 'stale',
      runId: 'run',
      revision: 1,
      sourceStatus: 'deleted',
    });
  const feature = {
    lookup,
    preview: jest.fn(async () => ({ status: 'not_today' as const })),
    start: jest.fn(),
    active: jest.fn(() => null),
    retain: jest.fn(() => () => {}),
  } as unknown as ReturnType<typeof createDailyReportFeature>;
  await render(
    <DailyReportRoute
      feature={feature}
      initialIdentity={identity}
      providerSelection={null}
      onBack={jest.fn()}
      onChat={jest.fn()}
    />,
  );
  await screen.findByText('합성 기록');
  expect(screen.getByText('불러온 원본 기록 1건')).toBeTruthy();
  await act(async () => {
    notifyLocalSourceDeleted();
  });
  expect(screen.queryByText('합성 기록')).toBeNull();
  expect(screen.queryByText('불러온 원본 기록 1건')).toBeNull();
  expect(
    await screen.findByText(
      '보고서의 출처 기록이 삭제되어 저장된 내용을 표시할 수 없어요.',
    ),
  ).toBeTruthy();
  expect(lookup).toHaveBeenCalledTimes(2);
});
