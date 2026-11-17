import { providerSuccess } from '@orot/model-runtime';
import { createPublicWebEvidence } from '../publicWebEvidence';
import {
  publicEvidenceFixture,
  publicResponse,
} from '../testSupport/publicWebEvidenceTestSupport';

// Fake elapsed time proves cancellation and publication boundaries, not live network speed.
afterEach(() => jest.useRealTimers());

test('keeps the selected provider alive after thirty seconds and accepts its cited result', async () => {
  jest.useFakeTimers();
  const run = publicEvidenceFixture();
  run.search.mockImplementation(
    () =>
      new Promise(resolve => {
        setTimeout(() => resolve(providerSuccess(publicResponse)), 45_000);
      }),
  );
  const pending = createPublicWebEvidence(run)!.tool.search(run.request);
  const outcome = pending.then(
    value => value,
    () => 'rejected',
  );
  await jest.advanceTimersByTimeAsync(30_001);
  expect(run.search.mock.calls[0]![1]!.signal!.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(14_999);
  expect(await outcome).toMatchObject({
    items: [expect.objectContaining({ sourceKind: 'external_medical' })],
  });
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(run.authorize).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('Stop during the extended window wins over a late provider result without retrying', async () => {
  jest.useFakeTimers();
  const run = publicEvidenceFixture();
  let finish!: (value: Awaited<ReturnType<typeof run.search>>) => void;
  run.search.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const pending = createPublicWebEvidence({
    ...run,
    recoverUnavailable: true,
  })!.tool.search(run.request);
  const outcome = pending.then(
    () => 'published',
    () => 'cancelled',
  );
  await jest.advanceTimersByTimeAsync(45_000);
  run.controller.abort();
  expect(await outcome).toBe('cancelled');
  expect(run.search.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  finish(providerSuccess(publicResponse));
  await Promise.resolve();
  expect(await outcome).toBe('cancelled');
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});

test('a genuine watchdog expiry remains a timeout and cannot be replaced by late success', async () => {
  jest.useFakeTimers();
  const run = publicEvidenceFixture();
  let finish!: (value: Awaited<ReturnType<typeof run.search>>) => void;
  run.search.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const outcome = createPublicWebEvidence({
    ...run,
    recoverUnavailable: true,
  })!.tool.search(run.request);
  await jest.advanceTimersByTimeAsync(179_999);
  expect(run.search.mock.calls[0]![1]!.signal!.aborted).toBe(false);
  await jest.advanceTimersByTimeAsync(1);
  const timedOut = await outcome;
  expect(timedOut).toMatchObject({
    items: [],
    coverage: [
      {
        gaps: [
          'Public web search timed out; no external evidence was retrieved.',
        ],
      },
    ],
  });
  expect(run.search.mock.calls[0]![1]!.signal!.aborted).toBe(true);
  finish(providerSuccess(publicResponse));
  await Promise.resolve();
  expect(await outcome).toBe(timedOut);
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
