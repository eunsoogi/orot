import { guardProviderAuthorization } from '../src/multiAgent/authorizedProvider';
import { makeProvider } from './multiAgent-external-evidence-fixtures';

// Custom current-only ports have no event subscription. Rejecting a result must
// still abort retained native work and prevent reuse of the same workflow child.
test.each(['generate', 'stream'] as const)(
  '%s currentness loss aborts retained work before the parent run ends',
  async (mode) => {
    const { provider } = makeProvider(['Synthetic']);
    const original = provider.generate;
    let current = true;
    let nativeSignal: AbortSignal | undefined;
    const native = jest.fn();
    provider.generate = async (request, options) => {
      native();
      nativeSignal = options?.signal;
      const result = await original(request, options);
      current = false;
      return result;
    };
    provider.stream = async function* (_request, options) {
      native();
      nativeSignal = options?.signal;
      current = false;
      yield { ok: true, value: { type: 'text_delta', text: 'Never published' } };
    };
    const parent = new AbortController();
    const guarded = guardProviderAuthorization(provider, () => current);
    const request = { messages: [{ role: 'user' as const, content: 'Synthetic' }] };
    const call =
      mode === 'generate'
        ? guarded.provider.generate(request, { signal: parent.signal })
        : guarded.provider.stream!(request, { signal: parent.signal })
            [Symbol.asyncIterator]()
            .next();
    await expect(call).rejects.toThrow();
    expect(guarded.wasDenied()).toBe(true);
    expect(nativeSignal?.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    current = true;
    const replacement = guardProviderAuthorization(provider, () => current);
    await expect(
      replacement.provider.generate(request, { signal: parent.signal }),
    ).rejects.toThrow();
    expect(native).toHaveBeenCalledTimes(1);
    parent.abort();
  },
);

test.each([false, true])(
  'terminal stream currentness rejects done (prior event: %s)',
  async (hasEvent) => {
    const { provider } = makeProvider(['Synthetic']);
    let current = true;
    let nativeSignal: AbortSignal | undefined;
    let finish!: () => void;
    const waiting = new Promise<void>((resolve) => {
      finish = resolve;
    });
    provider.stream = async function* (_request, options) {
      nativeSignal = options?.signal;
      if (hasEvent) yield { ok: true, value: { type: 'text_delta', text: 'Before revoke' } };
      await waiting;
    };
    const parent = new AbortController();
    const guarded = guardProviderAuthorization(provider, () => current);
    const request = { messages: [{ role: 'user' as const, content: 'Synthetic' }] };
    const iterator = guarded.provider.stream!(request, { signal: parent.signal })[
      Symbol.asyncIterator
    ]();
    if (hasEvent) expect((await iterator.next()).done).toBe(false);
    const terminal = iterator.next();
    current = false;
    finish();
    await expect(terminal).rejects.toThrow();
    expect(nativeSignal?.aborted).toBe(true);
    expect(parent.signal.aborted).toBe(false);
    expect(guarded.wasDenied()).toBe(true);
    current = true;
    const replacement = guardProviderAuthorization(provider, () => current);
    await expect(
      replacement.provider.generate(request, { signal: parent.signal }),
    ).rejects.toThrow();
    parent.abort();
  },
);
