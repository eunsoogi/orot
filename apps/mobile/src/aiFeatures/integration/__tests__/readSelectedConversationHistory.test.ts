import { readSelectedConversationHistory } from '../readSelectedConversationHistory';

// Batch boundaries must not schedule more protected reads after Stop.
test.each([true, false])(
  'selected history batching preserves cancellation=%s',
  async cancel => {
    const controller = new AbortController();
    const ids = Array.from({ length: 51 }, (_, index) => `synthetic-${index}`);
    const readSession = jest.fn(
      async ({ ids: selected }: { ids: string[] }) => {
        if (cancel) controller.abort();
        return {
          items: selected.map(id => ({ id })),
          unavailableCount: 0,
          nextCursor: null,
        };
      },
    );
    const pending = readSelectedConversationHistory(
      { readSession } as never,
      'session',
      ids,
      controller.signal,
    );
    if (cancel) {
      await expect(pending).rejects.toMatchObject({
        code: 'history_cancelled',
      });
      expect(readSession).toHaveBeenCalledTimes(1);
    } else {
      await expect(pending).resolves.toHaveLength(51);
      expect(
        readSession.mock.calls.map(([request]) => request.ids.length),
      ).toEqual([50, 1]);
    }
  },
);
