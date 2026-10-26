import { boundedVisitGeneration } from '../boundedVisitGeneration';

test('keeps the default request alive beyond 90 seconds until the person cancels', async () => {
  jest.useFakeTimers();
  try {
    const controller = new AbortController();
    let active: AbortSignal | undefined;
    let completed = false;
    const pending = boundedVisitGeneration(controller.signal, async signal => {
      active = signal;
      return new Promise<never>(() => {});
    }).then(result => {
      completed = true;
      return result;
    });
    await jest.advanceTimersByTimeAsync(180_000);
    expect(completed).toBe(false);
    expect(active?.aborted).toBe(false);
    controller.abort();
    await expect(pending).resolves.toEqual({ status: 'cancelled' });
    expect(active?.aborted).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

test('keeps the route alive for a valid 60-second tool workflow', async () => {
  jest.useFakeTimers();
  try {
    const result = boundedVisitGeneration(
      new AbortController().signal,
      async () => {
        await new Promise(resolve => setTimeout(resolve, 60_000));
        return { status: 'ready' as const };
      },
    );
    await jest.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toEqual({ status: 'ready' });
  } finally {
    jest.useRealTimers();
  }
});

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
