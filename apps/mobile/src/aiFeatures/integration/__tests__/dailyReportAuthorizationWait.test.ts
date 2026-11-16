import type {
  OutboundProcessingRequest,
  ConsentDecision,
} from '@orot/agent-runtime';
import {
  reportConsent,
  reportProcessingDeadline,
} from '../dailyReportAuthorizationWait';
import {
  boundedDailyReport,
  createDailyReportDeadlineContext,
} from '../dailyReportDeadline';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: () => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = () => fail(new Error('synthetic'));
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
const request = (signal = new AbortController().signal) =>
  ({ signal }) as OutboundProcessingRequest;
afterEach(() => jest.useRealTimers());

test('nested budgets retain spent time and resume once after all authorization waits settle', async () => {
  jest.useFakeTimers();
  const context = createDailyReportDeadlineContext();
  const expired = [jest.fn(), jest.fn(), jest.fn()];
  const deadlines = [120_000, 100_000, 90_000].map((ms, i) =>
    reportProcessingDeadline(context, expired[i]!, ms),
  );
  jest.advanceTimersByTime(10_000);
  const first = deferred<ConsentDecision>();
  const second = deferred<ConsentDecision>();
  const authorize = jest
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const consent = reportConsent({ authorize }, context);
  const one = consent.authorize(request());
  const two = consent.authorize(request()).catch(() => 'rejected');
  jest.advanceTimersByTime(120_000);
  expect(expired.every(fn => fn.mock.calls.length === 0)).toBe(true);
  first.resolve('authorized');
  await one;
  jest.advanceTimersByTime(120_000);
  expect(expired.every(fn => fn.mock.calls.length === 0)).toBe(true);
  second.reject();
  await two;
  jest.advanceTimersByTime(79_999);
  expect(expired.every(fn => fn.mock.calls.length === 0)).toBe(true);
  jest.advanceTimersByTime(1);
  expect(expired[2]).toHaveBeenCalledTimes(1);
  expect(expired[1]).not.toHaveBeenCalled();
  jest.advanceTimersByTime(10_000);
  expect(expired[1]).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(20_000);
  expect(expired[0]).toHaveBeenCalledTimes(1);
  for (const deadline of deadlines) deadline.dispose();
  expect(jest.getTimerCount()).toBe(0);
});

test.each(['authorized', 'renewal_required'] as const)(
  'nested report bounds allow a visible decision past 90 seconds: %s',
  async decision => {
    jest.useFakeTimers();
    const context = createDailyReportDeadlineContext();
    const controller = new AbortController();
    const choice = deferred<ConsentDecision>();
    const expired = jest.fn(() => ({
      status: 'failed' as const,
      code: 'timeout' as const,
    }));
    let visible!: AbortSignal;
    const result = boundedDailyReport(
      controller.signal,
      90_000,
      outer =>
        boundedDailyReport(
          outer,
          90_000,
          async signal => {
            visible = signal;
            return reportConsent(
              { authorize: () => choice.promise },
              context,
            ).authorize(request(signal));
          },
          expired,
          context,
        ),
      expired,
      context,
    );
    await flush();
    jest.advanceTimersByTime(180_000);
    expect(visible.aborted).toBe(false);
    expect(expired).not.toHaveBeenCalled();
    choice.resolve(decision);
    await expect(result).resolves.toBe(decision);
    expect(jest.getTimerCount()).toBe(0);
  },
);

test('Stop still releases nested report bounds; late decisions cannot recreate their timers', async () => {
  jest.useFakeTimers();
  const context = createDailyReportDeadlineContext();
  const owner = new AbortController();
  const choice = deferred<ConsentDecision>();
  const expired = jest.fn(() => ({
    status: 'failed' as const,
    code: 'timeout' as const,
  }));
  const result = boundedDailyReport(
    owner.signal,
    90_000,
    signal =>
      reportConsent({ authorize: () => choice.promise }, context).authorize(
        request(signal),
      ),
    expired,
    context,
  );
  await flush();
  owner.abort();
  await expect(result).resolves.toEqual({
    status: 'failed',
    code: 'cancelled',
  });
  choice.resolve('authorized');
  await flush();
  jest.advanceTimersByTime(180_000);
  expect(expired).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});

test('non-consent hung work still times out after the remaining processing budget', async () => {
  jest.useFakeTimers();
  const context = createDailyReportDeadlineContext();
  const choice = deferred<ConsentDecision>();
  const result = boundedDailyReport(
    new AbortController().signal,
    90_000,
    async signal => {
      await new Promise(resolve => setTimeout(resolve, 10_000));
      await reportConsent(
        { authorize: () => choice.promise },
        context,
      ).authorize(request(signal));
      return new Promise(() => {});
    },
    undefined,
    context,
  );
  jest.advanceTimersByTime(10_000);
  await flush();
  jest.advanceTimersByTime(180_000);
  choice.resolve('authorized');
  await flush();
  jest.advanceTimersByTime(80_000);
  await expect(result).resolves.toEqual({ status: 'failed', code: 'timeout' });
  expect(jest.getTimerCount()).toBe(0);
});
