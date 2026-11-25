import { settleKnownIndependentRead } from '../independentReadSettlement';

const exact = <T>(value: T) => value;

test('preserves a timeout even if the owner changes before the waiter resumes', async () => {
  jest.useFakeTimers();
  try {
    const owner = { pending: 1, dirtyTransactions: 0, unsettledFailure: false };
    const result = settleKnownIndependentRead(owner, 1, undefined, exact);
    jest.advanceTimersByTime(1);
    owner.unsettledFailure = true;
    expect(await result).toBe('wait_expired');
  } finally {
    jest.useRealTimers();
  }
});

test('classifies exact cancellation and dirty settlement even before continuation', async () => {
  const owner = {
    pending: 1,
    dirtyTransactions: 1,
    unsettledFailure: false,
    settleListeners: new Set<() => void>(),
  };
  const controller = new AbortController();
  const cancelled = settleKnownIndependentRead(
    owner,
    2_500,
    controller.signal,
    exact,
  );
  const poisoned = settleKnownIndependentRead(owner, 2_500, undefined, exact);
  controller.abort();
  owner.pending = 0;
  owner.dirtyTransactions = 0;
  owner.unsettledFailure = true;
  for (const notify of owner.settleListeners) notify();
  owner.unsettledFailure = false;
  expect(await cancelled).toBe('cancelled');
  expect(await poisoned).toBe('settlement_failed');
  expect(owner.settleListeners.size).toBe(0);
});

test('the original Boolean admission still rejects a timed-out writer', async () => {
  jest.useFakeTimers();
  try {
    const result = settleKnownIndependentRead(
      { pending: 1, dirtyTransactions: 1 },
      1,
      undefined,
      outcome => outcome === 'settled',
    );
    jest.advanceTimersByTime(1);
    expect(await result).toBe(false);
  } finally {
    jest.useRealTimers();
  }
});
