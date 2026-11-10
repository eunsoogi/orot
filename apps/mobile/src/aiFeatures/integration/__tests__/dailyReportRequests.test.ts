import { createDailyReportIdentity } from '@orot/domain';
import { createDailyReportRequests } from '../dailyReportRequests';

const today = createDailyReportIdentity('2026-11-10', 'Asia/Seoul');
const old = createDailyReportIdentity('2026-11-09', 'Asia/Seoul');

test('lookup never starts inference and an old identity cannot generate', async () => {
  const lookup = jest.fn().mockResolvedValue({ status: 'missing' });
  const run = jest.fn();
  const requests = createDailyReportRequests({
    lookup,
    run,
    currentIdentity: () => today,
  });
  await requests.lookup(old);
  expect(lookup).toHaveBeenCalledWith(old);
  expect(requests.start(old, { kind: 'reuse_or_generate' })).toEqual({
    status: 'not_today',
  });
  expect(run).not.toHaveBeenCalled();
});

test('concurrent entries share a run and cancellation; incompatible revisions stay busy', async () => {
  let finish!: (value: { status: 'failed'; code: string }) => void;
  const run = jest.fn().mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const requests = createDailyReportRequests({
    lookup: jest.fn(),
    run,
    currentIdentity: () => today,
  });
  const first = requests.start(today, { kind: 'reuse_or_generate' });
  const second = requests.start(today, { kind: 'reuse_or_generate' });
  if (first.status !== 'started' || second.status !== 'started')
    throw new Error('Expected a shared request');
  expect(first.result).toBe(second.result);
  expect(
    requests.start(today, { kind: 'revise', expectedRunId: null }),
  ).toEqual({ status: 'busy' });
  await Promise.resolve();
  expect(run).toHaveBeenCalledTimes(1);
  second.cancel();
  expect(run.mock.calls[0][2].aborted).toBe(true);
  finish({ status: 'failed', code: 'cancelled' });
  await first.result;
  expect(requests.start(today, { kind: 'reuse_or_generate' }).status).toBe(
    'started',
  );
});

test('a request arriving after midnight cannot join the previous day', async () => {
  let current = today;
  let finish!: (value: { status: 'failed'; code: string }) => void;
  const run = jest.fn().mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const requests = createDailyReportRequests({
    lookup: jest.fn(),
    run,
    currentIdentity: () => current,
  });
  const first = requests.start(today, { kind: 'reuse_or_generate' });
  await Promise.resolve();
  current = createDailyReportIdentity('2026-11-11', 'Asia/Seoul');
  expect(requests.start(today, { kind: 'reuse_or_generate' })).toEqual({
    status: 'not_today',
  });
  finish({ status: 'failed', code: 'cancelled' });
  if (first.status === 'started') await first.result;
});
