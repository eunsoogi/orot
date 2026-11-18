import { guardProviderAuthorization } from '../src/multiAgent/authorizedProvider';
import { makeProvider } from './multiAgent-external-evidence-fixtures';

test('revocation aborts the invocation-owned signal and discards a late native answer', async () => {
  const { provider } = makeProvider(['Synthetic']);
  let invalidated!: () => void;
  let complete!: (value: Awaited<ReturnType<typeof provider.generate>>) => void;
  let nativeSignal: AbortSignal | undefined;
  const stop = jest.fn();
  const original = provider.generate;
  provider.generate = jest.fn((_request, options) => {
    nativeSignal = options?.signal;
    return new Promise((resolve) => {
      complete = resolve;
    });
  });
  let live = true;
  const guarded = guardProviderAuthorization(
    provider,
    () => live,
    (listener) => {
      invalidated = listener;
      return stop;
    },
  );
  const request = { messages: [{ role: 'user' as const, content: 'Synthetic' }] };
  const parent = new AbortController();
  const call = guarded.provider.generate(request, { signal: parent.signal });
  expect(nativeSignal?.aborted).toBe(false);
  live = false;
  invalidated();
  expect(nativeSignal?.aborted).toBe(true);
  expect(parent.signal.aborted).toBe(false);
  complete(await original(request));
  await expect(call).rejects.toThrow();
  expect(guarded.wasDenied()).toBe(true);
  expect(stop).toHaveBeenCalledTimes(1);
});

test('completed calls release their credential observer', async () => {
  const { provider } = makeProvider(['Synthetic']);
  const stop = jest.fn();
  const guarded = guardProviderAuthorization(
    provider,
    () => true,
    () => stop,
  );
  await guarded.provider.generate({ messages: [{ role: 'user', content: 'Synthetic' }] });
  expect(stop).toHaveBeenCalledTimes(1);
  expect(guarded.wasDenied()).toBe(false);
});

test('a running stream aborts and rejects its next late event after revocation', async () => {
  const { provider } = makeProvider(['Synthetic']);
  let invalidated!: () => void;
  let signal: AbortSignal | undefined;
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stop = jest.fn();
  const stream: NonNullable<typeof provider.stream> = async function* (_request, options) {
    signal = options?.signal;
    yield { ok: true, value: { type: 'text_delta', text: 'Before revocation' } };
    await waiting;
    yield { ok: true, value: { type: 'text_delta', text: 'Never published' } };
  };
  const guarded = guardProviderAuthorization(
    { ...provider, stream },
    () => true,
    (listener) => {
      invalidated = listener;
      return stop;
    },
  );
  const iterator = guarded.provider.stream!({ messages: [{ role: 'user', content: 'Synthetic' }] })[
    Symbol.asyncIterator
  ]();
  expect((await iterator.next()).value).toMatchObject({ value: { text: 'Before revocation' } });
  const next = iterator.next();
  invalidated();
  expect(signal?.aborted).toBe(true);
  release();
  await expect(next).rejects.toThrow();
  expect(guarded.wasDenied()).toBe(true);
  expect(stop).toHaveBeenCalledTimes(1);
});

test('retained native tool work stays linked to revocation until its owning workflow ends', async () => {
  const { provider } = makeProvider(['Synthetic']);
  const original = provider.generate;
  let nativeSignal: AbortSignal | undefined;
  provider.generate = async (request, options) => {
    nativeSignal = options?.signal;
    return original(request, options);
  };
  let invalidate!: () => void;
  const removed = jest.fn();
  const parent = new AbortController();
  const guarded = guardProviderAuthorization(
    provider,
    () => true,
    (listener) => {
      invalidate = listener;
      return removed;
    },
  );
  await guarded.provider.generate(
    { messages: [{ role: 'user', content: 'Synthetic' }] },
    { signal: parent.signal },
  );
  expect(removed).not.toHaveBeenCalled();
  expect(nativeSignal?.aborted).toBe(false);
  invalidate();
  expect(nativeSignal?.aborted).toBe(true);
  expect(parent.signal.aborted).toBe(false);
  expect(removed).toHaveBeenCalledTimes(1);
  parent.abort();
  expect(removed).toHaveBeenCalledTimes(1);
});

test('tool continuations share only their run signal while each invocation checks a fresh grant', async () => {
  const { provider } = makeProvider(['Synthetic', 'Synthetic', 'Synthetic']);
  const original = provider.generate;
  const signals: (AbortSignal | undefined)[] = [];
  provider.generate = async (request, options) => {
    signals.push(options?.signal);
    return original(request, options);
  };
  const parent = new AbortController();
  const otherParent = new AbortController();
  let revokeFirst!: () => void;
  const first = guardProviderAuthorization(
    provider,
    () => true,
    (listener) => {
      revokeFirst = listener;
      return () => {};
    },
  );
  const secondCheck = jest.fn(() => true);
  const second = guardProviderAuthorization(provider, secondCheck);
  const other = guardProviderAuthorization(provider, () => true);
  const request = { messages: [{ role: 'user' as const, content: 'Synthetic' }] };
  await first.provider.generate(request, { signal: parent.signal });
  await second.provider.generate(request, { signal: parent.signal });
  await other.provider.generate(request, { signal: otherParent.signal });
  expect(signals[0]).toBe(signals[1]);
  expect(signals[0]).not.toBe(signals[2]);
  expect(secondCheck).toHaveBeenCalled();
  revokeFirst();
  expect(signals[0]?.aborted).toBe(true);
  expect(signals[2]?.aborted).toBe(false);
  const afterRevoke = guardProviderAuthorization(provider, () => true);
  await expect(afterRevoke.provider.generate(request, { signal: parent.signal })).rejects.toThrow();
  expect(signals).toHaveLength(3);
  otherParent.abort();
});
