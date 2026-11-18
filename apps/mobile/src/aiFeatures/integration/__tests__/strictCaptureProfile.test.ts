import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import {
  conversationHistorySources,
  conversationHistoryIsCurrent,
} from '../conversationHistorySources';

test.each([false, true])(
  'synthetic capture native graph classification=%s',
  async native => {
    const f = await diverseHistoryProfileFixture(5, false);
    try {
      const signal = new AbortController().signal;
      const saved = await f.storage.readMany(
        Array.from({ length: 5 }, (_, i) => `turn-${i}`),
      );
      const history = await conversationHistorySources({
        session: {
          id: 'session',
          version: (await f.storage.activeSessionVersion('session'))!,
        },
        retainedHistory: saved.map(row => ({
          id: row!.id,
          question: row!.question,
        })),
        data: await f.input.loadLocalData(),
        registry: f.input.registry,
        signal,
      });
      const strict = jest.spyOn(f.discovery, 'read');
      const one = jest.spyOn(f.storage, 'read');
      const many = jest.spyOn(f.storage, 'readMany');
      const initial = f.storage.readManyWithAncestry.bind(f.storage);
      if (native)
        jest
          .spyOn(f.storage, 'readManyWithAncestry')
          .mockImplementation(async ids => {
            const result = await initial(ids);
            const ancestry = new Map(result.ancestry);
            const row = ancestry.values().next().value!;
            ancestry.set('synthetic-native-marker', {
              ...row,
              submittedInput: {} as NonNullable<typeof row.submittedInput>,
            });
            return { ...result, ancestry };
          });
      const start = Date.now();
      const valid = await conversationHistoryIsCurrent(
        f.input.registry,
        history.references,
        signal,
      );
      console.log(
        JSON.stringify({
          native,
          valid,
          ms: Date.now() - start,
          roots: history.references.length,
          strict: strict.mock.calls.length,
          one: one.mock.calls.length,
          many: many.mock.calls.length,
        }),
      );
      expect(valid).toBe(true);
    } finally {
      jest.restoreAllMocks();
      f.close();
    }
  },
);
