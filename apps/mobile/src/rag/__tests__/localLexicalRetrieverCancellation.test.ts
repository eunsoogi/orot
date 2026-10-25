import type { EvidenceChunk } from '@orot/rag';
import { lexicalSetup } from '../testSupport/lexicalRetrieverFixtures';

describe('lexical retriever cancellation', () => {
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
