import {
  providerSuccess,
  type LanguageModelProvider,
} from '@orot/model-runtime';
import { guardSelectedRecordingProvider } from '../selectedRecordingProvider';

const request = { messages: [] };
function fixture() {
  const generate = jest.fn(async () =>
    providerSuccess({
      text: 'synthetic',
      toolCalls: [],
      finishReason: 'complete' as const,
    }),
  );
  const entered = jest.fn();
  const stream = jest.fn(async function* () {
    entered();
    yield providerSuccess({ type: 'text_delta' as const, text: 'synthetic' });
  });
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'fixture',
    displayName: 'fixture',
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: false,
    },
    generate,
    stream,
  };
  return { provider, generate, stream, entered };
}

test.each(['generate', 'stream'] as const)(
  'a %s dispatch cannot use a positive native result after the exact ticket retires',
  async mode => {
    const f = fixture();
    let release!: (value: boolean) => void;
    const sample = new Promise<boolean>(resolve => (release = resolve));
    const sampleNative = jest.fn(() => sample);
    let current = true;
    const old = guardSelectedRecordingProvider(
      f.provider,
      sampleNative,
      () => current,
    );
    const run =
      mode === 'generate'
        ? old.generate(request)
        : old.stream!(request)
            [Symbol.asyncIterator]()
            .next()
            .then(item => item.value);
    expect(sampleNative).toHaveBeenCalledTimes(1);
    release(true);
    // Native completion was positive; the selected operation retires in the
    // queued gap before the caller can hand off its first provider operation.
    queueMicrotask(() => (current = false));
    await expect(run).resolves.toMatchObject({ ok: false });
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.stream).not.toHaveBeenCalled();
    expect(f.entered).not.toHaveBeenCalled();

    // The revocation belongs only to the old ticket, not to a new same-provider turn.
    const next = guardSelectedRecordingProvider(
      f.provider,
      async () => true,
      () => true,
    );
    if (mode === 'generate') {
      await expect(next.generate(request)).resolves.toMatchObject({ ok: true });
      expect(f.generate).toHaveBeenCalledTimes(1);
    } else {
      const iterator = next.stream!(request)[Symbol.asyncIterator]();
      await expect(iterator.next()).resolves.toMatchObject({
        value: { ok: true },
      });
      expect(f.entered).toHaveBeenCalledTimes(1);
      await iterator.return?.();
    }
  },
);
