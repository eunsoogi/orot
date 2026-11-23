import type { LanguageModelProvider } from '@orot/model-runtime';
import { dailyReportWarmProviderGuard } from '../dailyReportWarmProviderGuard';

test.each(['generate', 'stream'] as const)(
  'a child-only abort during durable proof prevents %s and leaves its live sibling alone',
  async method => {
    const parent = new AbortController();
    const child = new AbortController();
    const sibling = new AbortController();
    const generate = jest.fn(async () => ({ ok: true }));
    const stream = jest.fn(async function* () {
      yield { ok: true };
    });
    const base = { generate, stream } as unknown as LanguageModelProvider;
    let arrived!: () => void;
    const starting = new Promise<void>(resolve => {
      arrived = resolve;
    });
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const proof = jest
      .fn(async () => true)
      .mockImplementationOnce(async () => {
        arrived();
        await gate;
        return true;
      });
    const provider = dailyReportWarmProviderGuard(
      base,
      () => !parent.signal.aborted,
      proof,
    );
    const result =
      method === 'generate'
        ? provider.generate({} as never, { signal: child.signal })
        : provider.stream!({} as never, { signal: child.signal })
            [Symbol.asyncIterator]()
            .next();
    await starting;
    child.abort();
    release();
    await result;
    expect(parent.signal.aborted).toBe(false);
    expect(generate.mock.calls.length + stream.mock.calls.length).toBe(0);
    await provider.generate({} as never, { signal: sibling.signal });
    expect(generate.mock.calls.length).toBe(1);
    expect(stream.mock.calls.length).toBe(0);
  },
);
