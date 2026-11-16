import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { withConcurrentConversationOpening } from '../concurrentConversationOpening';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

test('model work overlaps but final presentation waits for the opening', async () => {
  const first = deferred<void>();
  const final = deferred<string>();
  const events: string[] = [];
  const result = withConcurrentConversationOpening({
    signal: new AbortController().signal,
    consent: { authorize: async () => 'authorized' },
    open: async () => {
      events.push('opening-start');
      await first.promise;
      events.push('opening');
    },
    run: async () => {
      events.push('final-start');
      return final.promise;
    },
  }).then(value => {
    events.push(value);
  });
  await Promise.resolve();
  expect(events).toEqual(['final-start', 'opening-start']);
  final.resolve('final');
  await Promise.resolve();
  expect(events).not.toContain('final');
  first.resolve();
  await result;
  expect(events.slice(-2)).toEqual(['opening', 'final']);
});

test('exact consent requests queue without sharing approval; stopped queued preview is not shown', async () => {
  const controller = new AbortController();
  const decision = deferred<'authorized'>();
  const finalRequest = {
    signal: controller.signal,
    payload: { exact: 'final' },
  } as unknown as OutboundProcessingRequest;
  const authorize = jest.fn(() => decision.promise);
  let previewSignal!: AbortSignal;
  const result = withConcurrentConversationOpening({
    signal: controller.signal,
    consent: { authorize },
    run: async consent => {
      await consent.authorize(finalRequest);
      return 'final';
    },
    open: async (consent, signal) => {
      previewSignal = signal;
      expect(
        await consent.authorize({
          ...finalRequest,
          signal,
          payload: { exact: 'preview' },
        } as unknown as OutboundProcessingRequest),
      ).toBe('renewal_required');
    },
  });
  await Promise.resolve();
  await Promise.resolve();
  expect(authorize).toHaveBeenCalledTimes(1);
  expect(authorize).toHaveBeenCalledWith(finalRequest);
  controller.abort();
  expect(previewSignal.aborted).toBe(true);
  decision.resolve('authorized');
  await result;
  expect(authorize).toHaveBeenCalledTimes(1);
});

test('optional failure cannot fail the final task', async () => {
  await expect(
    withConcurrentConversationOpening({
      signal: new AbortController().signal,
      consent: { authorize: async () => 'authorized' },
      open: async () => {
        throw new Error('synthetic failure');
      },
      run: async () => 'final',
    }),
  ).resolves.toBe('final');
});

test('bounded processing gate cancels only a stalled preview', async () => {
  jest.useFakeTimers();
  const owner = new AbortController();
  let preview!: AbortSignal;
  const result = withConcurrentConversationOpening({
    signal: owner.signal,
    consent: { authorize: async () => 'authorized' },
    open: async (_consent, signal) => {
      preview = signal;
      await new Promise(() => {});
    },
    run: async () => 'final',
  });
  await Promise.resolve();
  jest.advanceTimersByTime(10_000);
  await expect(result).resolves.toBe('final');
  expect(preview.aborted).toBe(true);
  expect(owner.signal.aborted).toBe(false);
  jest.useRealTimers();
});

test('completed opening never reports a timeout while the final task continues', async () => {
  jest.useFakeTimers();
  const final = deferred<string>();
  const onTimeout = jest.fn();
  const result = withConcurrentConversationOpening({
    signal: new AbortController().signal,
    consent: { authorize: async () => 'authorized' },
    open: async () => {},
    run: () => final.promise,
    onTimeout,
  });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  jest.advanceTimersByTime(10_000);
  expect(onTimeout).not.toHaveBeenCalled();
  final.resolve('final');
  await result;
  jest.useRealTimers();
});
