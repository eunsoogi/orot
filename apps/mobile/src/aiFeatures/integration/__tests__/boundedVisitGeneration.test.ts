import { boundedVisitGeneration } from '../boundedVisitGeneration';

test('cancels provider preparation promptly and rejects its late result', async () => {
  const controller = new AbortController();
  let release!: () => void;
  const waiting = new Promise<void>(resolve => {
    release = resolve;
  });
  const dispatch = jest.fn();
  const result = boundedVisitGeneration(controller.signal, async signal => {
    await waiting;
    if (!signal.aborted) dispatch();
    return { status: 'ready' as const };
  });
  controller.abort();
  await expect(result).resolves.toEqual({ status: 'cancelled' });
  release();
  await Promise.resolve();
  expect(dispatch).not.toHaveBeenCalled();
});

test('times out preparation and aborts underlying work before allowing retry', async () => {
  jest.useFakeTimers();
  let active: AbortSignal | undefined;
  const result = boundedVisitGeneration(
    new AbortController().signal,
    async signal => {
      active = signal;
      return new Promise<never>(() => {});
    },
    50,
  );
  jest.advanceTimersByTime(50);
  expect(active?.aborted).toBe(true);
  await expect(result).resolves.toMatchObject({ status: 'unavailable' });
  jest.useRealTimers();
});
