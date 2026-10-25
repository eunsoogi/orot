import type { EvidenceChunk } from '@orot/rag';
import { lexicalSetup } from '../testSupport/lexicalRetrieverFixtures';

describe('lexical retriever cancellation', () => {
  it('forwards the timeout-derived signal through public invoke and rejects late results', async () => {
    const { retriever, textStore } = lexicalSetup();
    const deadline = new AbortController();
    // Control only the deadline clock: the installed LangChain normalizer and
    // the retriever's public invocation still create and forward the configuration.
    const timeout = jest
      .spyOn(AbortSignal, 'timeout')
      .mockReturnValue(deadline.signal);
    const observedAbort = jest.fn();
    (textStore.search as jest.Mock).mockImplementation(
      async (
        _query: string,
        _chunks: readonly EvidenceChunk[],
        _limit: number,
        signal?: AbortSignal,
      ) => {
        expect(signal).toBe(deadline.signal);
        signal!.addEventListener('abort', observedAbort, { once: true });
        deadline.abort();
        return [{ chunkId: 'first' }];
      },
    );
    try {
      await expect(
        retriever.invoke('진료', { timeout: 25 }),
      ).rejects.toMatchObject({ name: 'AbortError' });
      expect(timeout).toHaveBeenCalledTimes(1);
      expect(timeout).toHaveBeenCalledWith(25);
      expect(observedAbort).toHaveBeenCalledTimes(1);
    } finally {
      timeout.mockRestore();
    }
  });

  it.each(['deadline', 'caller'] as const)(
    'preserves both cancellation sources when the %s aborts with an explicit signal and timeout',
    async source => {
      const { retriever, textStore } = lexicalSetup();
      const deadline = new AbortController();
      const caller = new AbortController();
      const timeout = jest
        .spyOn(AbortSignal, 'timeout')
        .mockReturnValue(deadline.signal);
      const observedAbort = jest.fn();
      (textStore.search as jest.Mock).mockImplementation(
        async (
          _query: string,
          _chunks: readonly EvidenceChunk[],
          _limit: number,
          signal?: AbortSignal,
        ) => {
          expect(signal).toBeDefined();
          signal!.addEventListener('abort', observedAbort, { once: true });
          (source === 'deadline' ? deadline : caller).abort();
          expect(signal!.aborted).toBe(true);
          return [{ chunkId: 'first' }];
        },
      );
      try {
        await expect(
          retriever.invoke('진료', { signal: caller.signal, timeout: 25 }),
        ).rejects.toMatchObject({ name: 'AbortError' });
        expect(observedAbort).toHaveBeenCalledTimes(1);
        expect(
          source === 'deadline'
            ? caller.signal.aborted
            : deadline.signal.aborted,
        ).toBe(false);
      } finally {
        timeout.mockRestore();
      }
    },
  );

  it('keeps concurrent invocation signals separate and discards cancelled store results', async () => {
    const { retriever, textStore } = lexicalSetup();
    const cancelled = new AbortController();
    const active = new AbortController();
    let finish!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    (textStore.search as jest.Mock).mockImplementation(
      async (
        query: string,
        _chunks: readonly EvidenceChunk[],
        _limit: number,
        signal: AbortSignal,
      ) => {
        if (query === 'cancelled') {
          expect(signal).toBe(cancelled.signal);
          await new Promise<void>(resolve => {
            finish = resolve;
            markStarted();
          });
        } else {
          expect(signal).toBe(active.signal);
        }
        return [{ chunkId: 'first' }];
      },
    );
    const pending = retriever.invoke('cancelled', { signal: cancelled.signal });
    // Synchronize with actual store entry, rather than relying on scheduling delays.
    await started;
    await expect(
      retriever.invoke('active', { signal: active.signal }),
    ).resolves.toMatchObject([{ id: 'first' }]);
    cancelled.abort();
    finish();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not start lexical search after cancellation during the deletion lookup', async () => {
    const { retriever, removalReader, textStore } = lexicalSetup();
    const controller = new AbortController();
    removalReader.findRemovedEvidence.mockImplementation(async () => {
      controller.abort();
      return { sourceRecordIds: [], chunkIds: [] };
    });
    await expect(
      retriever.invoke('진료', { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(textStore.search).not.toHaveBeenCalled();
  });
});
