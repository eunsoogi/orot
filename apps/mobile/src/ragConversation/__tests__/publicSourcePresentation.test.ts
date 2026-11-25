import { waitForPublicSourcePresentation } from '../publicSourcePresentation';

afterEach(() => jest.useRealTimers());

test('a native presentation receipt admits exactly once before the fallback', async () => {
  jest.useFakeTimers();
  const controller = new AbortController();
  const gate = waitForPublicSourcePresentation(controller.signal);
  const result = jest.fn();
  const finished = gate.ready.then(result);
  jest.advanceTimersByTime(449);
  await Promise.resolve();
  expect(result).not.toHaveBeenCalled();
  gate.shown();
  gate.shown();
  jest.runOnlyPendingTimers();
  await finished;
  expect(result.mock.calls).toEqual([[true]]);
});

test('a missing native receipt is bounded, and a retired owner never starts', async () => {
  jest.useFakeTimers();
  const owner = new AbortController();
  const retired = new AbortController();
  const missing = waitForPublicSourcePresentation(owner.signal);
  const closed = waitForPublicSourcePresentation(retired.signal);
  retired.abort();
  closed.shown();
  jest.advanceTimersByTime(450);
  await expect(missing.ready).resolves.toBe(true);
  await expect(closed.ready).resolves.toBe(false);
  await expect(
    waitForPublicSourcePresentation(retired.signal).ready,
  ).resolves.toBe(false);
});
