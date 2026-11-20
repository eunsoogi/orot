import { createDailyReportIdentity } from '@orot/domain';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { DailyReportSourceLinks } from '../DailyReportSourceLinks';

test('linked sources are lazy, grouped, and scoped to the exact saved revision', async () => {
  const identity = createDailyReportIdentity('2035-01-01', 'UTC');
  const onOpen = jest.fn();
  const onStale = jest.fn();
  let release: (result: { status: 'deleted' }) => void = () => {};
  const sources = Array.from({ length: 4 }, (_, index) => ({
    ...reference,
    evidenceId: `synthetic-${index}`,
  }));
  const resolve = jest
    .fn()
    .mockResolvedValueOnce({
      status: 'current',
      sources,
      presentation: {
        statistics: [[0, 1, 2]],
        directSources: [3],
        otherSources: [],
      },
    })
    .mockImplementationOnce(
      () =>
        new Promise(complete => {
          release = complete;
        }),
    )
    .mockResolvedValueOnce({ status: 'stale' });
  const component = (revision: number) => (
    <DailyReportSourceLinks
      identity={identity}
      revision={revision}
      runId="synthetic-report"
      resolve={resolve}
      onOpen={onOpen}
      onStale={onStale}
      testIDPrefix="report"
    />
  );
  const view = await render(component(1));
  expect(resolve).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('report-sources'));
  expect(
    screen.getByRole('button', { name: '통계 출처 1 · 근거 원본 3건' }),
  ).toBeTruthy();
  expect(screen.getByRole('button', { name: '기록 출처 1 열기' })).toBeTruthy();
  await fireEvent.press(screen.getByTestId('report-individual-member-0'));
  const signal: AbortSignal = resolve.mock.calls[1]![3];
  await view.rerender(component(2));
  expect(signal.aborted).toBe(true);
  expect(screen.queryByTestId('report-statistic-0')).toBeNull();
  await act(async () => release({ status: 'deleted' }));
  expect(onStale).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('report-sources'));
  expect(onStale).toHaveBeenCalledTimes(1);
  expect(onOpen).not.toHaveBeenCalled();
  await view.unmount();
});
