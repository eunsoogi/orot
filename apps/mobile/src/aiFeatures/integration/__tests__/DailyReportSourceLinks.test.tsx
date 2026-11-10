import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { EvidenceReference } from '@orot/agent-runtime';
import { createDailyReportIdentity } from '@orot/domain';
import { DailyReportSourceLinks } from '../DailyReportSourceLinks';

test('revalidates the revision on click and opens its freshly issued reference', async () => {
  const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  const first = { evidenceId: 'old-alias' } as unknown as EvidenceReference;
  const refreshed = { evidenceId: 'new-alias' } as unknown as EvidenceReference;
  const resolve = jest
    .fn()
    .mockResolvedValueOnce({ status: 'current', sources: [first] })
    .mockResolvedValueOnce({ status: 'current', sources: [refreshed] });
  const onOpen = jest.fn();
  await render(
    <DailyReportSourceLinks
      identity={identity}
      runId="run"
      revision={1}
      resolve={resolve}
      onOpen={onOpen}
      onStale={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByText('기록 출처 확인'));
  await fireEvent.press(await screen.findByText('기록 출처 1 열기'));
  expect(onOpen).toHaveBeenCalledWith(refreshed);
  expect(resolve).toHaveBeenCalledTimes(2);
});

test('removes existing links when revalidation fails', async () => {
  const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  const resolve = jest
    .fn()
    .mockResolvedValueOnce({
      status: 'current',
      sources: [{ evidenceId: 'alias' }],
    })
    .mockResolvedValueOnce({ status: 'unavailable' });
  const onOpen = jest.fn();
  await render(
    <DailyReportSourceLinks
      identity={identity}
      runId="run"
      revision={1}
      resolve={resolve}
      onOpen={onOpen}
      onStale={jest.fn()}
    />,
  );
  await fireEvent.press(screen.getByText('기록 출처 확인'));
  await fireEvent.press(await screen.findByText('기록 출처 1 열기'));
  expect(
    await screen.findByText(
      '기록이 바뀌었거나 출처를 확인하지 못했어요. 보고서를 다시 확인해 주세요.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText('기록 출처 1 열기')).toBeNull();
  expect(onOpen).not.toHaveBeenCalled();
});

test('refreshes the report when its stored revision is no longer current', async () => {
  const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  const resolve = jest.fn().mockResolvedValue({ status: 'stale' });
  const onStale = jest.fn();
  await render(
    <DailyReportSourceLinks
      identity={identity}
      runId="run"
      revision={1}
      resolve={resolve}
      onOpen={jest.fn()}
      onStale={onStale}
    />,
  );
  await fireEvent.press(screen.getByText('기록 출처 확인'));
  expect(onStale).toHaveBeenCalledTimes(1);
});

test('refreshes the report when a cited source was deleted', async () => {
  const identity = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
  const onStale = jest.fn();
  await render(
    <DailyReportSourceLinks
      identity={identity}
      runId="run"
      revision={1}
      resolve={jest.fn(async () => ({ status: 'deleted' as const }))}
      onOpen={jest.fn()}
      onStale={onStale}
    />,
  );
  await fireEvent.press(screen.getByText('기록 출처 확인'));
  await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
  expect(
    screen.queryByText(
      '기록이 바뀌었거나 출처를 확인하지 못했어요. 보고서를 다시 확인해 주세요.',
    ),
  ).toBeNull();
});
