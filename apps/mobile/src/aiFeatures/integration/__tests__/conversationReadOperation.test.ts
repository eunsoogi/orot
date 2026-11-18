import { fingerprint } from '../evidenceUtils';
import {
  registerConversationReadOperation,
  withConversationReadOperation,
} from '../conversationReadOperation';
import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { createConversationPageHydration } from '../conversationPageHydration';
import type { AiFeatureLocalData } from '../localData';
import type { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

/** The explicit owner is the same production summary factory; wrappers below
 * observe calls without substituting source validity or aggregate results. */
test.each([false, true])(
  'report scope enabled=%s preserves all DAG callback reads',
  async enabled => {
    const f = await sharedAncestryProfileFixture(6, true);
    const data = await f.input.loadLocalData();
    const summaries = createSymptomSummaryStorage(f.database);
    const reads: string[] = [];
    const factory = async (
      scoped: AiFeatureLocalData,
      registry: LocalEvidenceReferenceRegistry,
    ) => {
      const discovery = createSummaryArtifactDiscovery({
        database: f.database,
        storage: summaries,
        data: scoped,
        registry,
      });
      return {
        ...discovery,
        read: async (id: string, signal?: AbortSignal) => {
          reads.push(id);
          return discovery.read(id, signal);
        },
      };
    };
    data.summaryArtifactDiscovery = registry => factory(data, registry);
    if (enabled) registerConversationReadOperation(data, factory);
    const ids = Array.from({ length: 6 }, (_, i) => `dag-turn-${i}`);
    const graph = await f.storage.readManyWithAncestry(ids);
    const transaction = f.database.transaction.bind(f.database);
    let aggregates = 0;
    let transactions = 0;
    f.database.transaction = async operation =>
      transaction(async tx => {
        transactions++;
        const execute = tx.execute.bind(tx);
        tx.execute = async (...args) => {
          if (/WITH days\(/.test(args[0])) aggregates++;
          return execute(...args);
        };
        await operation(tx);
      });
    try {
      let escaped!: AiFeatureLocalData;
      await withConversationReadOperation(data, async scoped => {
        escaped = scoped;
        const hydrate = createConversationPageHydration(
          {
            storage: f.storage,
            data: scoped,
            registry: f.input.registry,
            signal: new AbortController().signal,
          },
          graph.ancestry,
        );
        for (const id of ids) expect((await hydrate(id))?.id).toBe(id);
      });
      const sequence = (n: number): string[] => [
        `summary-${n}`,
        ...Array.from({ length: n }, (_, i) => sequence(i)).flat(),
      ];
      expect(reads).toEqual(
        Array.from({ length: 6 }, (_, i) => sequence(i)).flat(),
      );
      expect(reads).toHaveLength(63);
      expect(escaped.readHealthContext).toBe(data.readHealthContext);
      expect(escaped.summaryArtifactDiscovery).toBe(
        data.summaryArtifactDiscovery,
      );
      if (enabled) expect(aggregates).toBe(2);
      else expect(aggregates).toBe(22);
      console.info(
        JSON.stringify({ enabled, summaryReads: reads.length, aggregates }),
      );
      for (const cacheState of ['warm', 'cold-generation'] as const) {
        for (const mode of ['capture', 'session'] as const) {
          if (cacheState === 'cold-generation') {
            // An unrelated future record changes the dataset generation, not any
            // retained report's exact period or revision. Both sides start cold.
            await f.repository.put('health_observation', {
              ...f.inside,
              id: `outside-${mode}`,
              effectiveAt: '2027-01-01T00:00:00Z',
              recordedAt: '2027-01-01T00:00:00Z',
              ingestedAt: '2027-01-01T00:00:00Z',
            });
          }
          aggregates = 0;
          transactions = 0;
          reads.length = 0;
          if (mode === 'capture') {
            const pending = await f.discovery.captureOwner!.prepare(
              graph.items.map(row => ({
                id: row!.id,
                revision: fingerprint(row!),
              })),
              new AbortController().signal,
            );
            expect(await pending.finish()).toBe(true);
          } else {
            const page = await f.discovery.readSession({
              sessionId: 'session',
              ids,
              signal: new AbortController().signal,
            });
            expect(page.items).toHaveLength(6);
          }
          expect(reads).toHaveLength(63);
          const expected =
            enabled && mode === 'session'
              ? // Five warm committed base entries now seed storage and hydration alike.
                [cacheState === 'warm' ? 2 : 12, 2]
              : cacheState === 'warm'
                ? enabled
                  ? [26, 3]
                  : [36, 8]
                : mode === 'capture' && !enabled
                  ? [46, 13]
                  : [36, 8];
          // Custom sources retain the original strict hydration path; capture is unchanged.
          if (mode === 'session' && !enabled) expected[0]! -= 12;
          expect([aggregates, transactions]).toEqual(expected);
          console.info(
            JSON.stringify({
              enabled,
              cacheState,
              mode,
              summaryReads: reads.length,
              aggregates,
              transactions,
            }),
          );
        }
      }
    } finally {
      f.database.transaction = transaction;
      f.close();
    }
  },
);

test('unknown or replaced factory keeps the exact original data and callbacks', async () => {
  const f = await sharedAncestryProfileFixture(1, false);
  try {
    const data = await f.input.loadLocalData();
    await withConversationReadOperation(data, async scoped =>
      expect(scoped).toBe(data),
    );
    const factory = jest.fn(async () => {
      throw new Error('Must not bypass custom discovery');
    });
    registerConversationReadOperation(data, factory);
    const clone = { ...data };
    await withConversationReadOperation(clone, async scoped =>
      expect(scoped).toBe(clone),
    );
    const original = data.summaryArtifactDiscovery!;
    await withConversationReadOperation(data, async scoped => {
      expect(scoped).not.toBe(data);
      const replacement = (registry: LocalEvidenceReferenceRegistry) =>
        original(registry);
      data.summaryArtifactDiscovery = replacement;
      expect(scoped.summaryArtifactDiscovery).toBe(replacement);
    });
    await withConversationReadOperation(data, async scoped =>
      expect(scoped).toBe(data),
    );
    expect(factory).not.toHaveBeenCalled();
  } finally {
    f.close();
  }
});

test('failure releases an escaped scoped data object without replacing strict callbacks', async () => {
  const f = await sharedAncestryProfileFixture(1, false);
  try {
    const data = await f.input.loadLocalData();
    registerConversationReadOperation(data, (_scoped, registry) =>
      data.summaryArtifactDiscovery!(registry),
    );
    let escaped!: AiFeatureLocalData;
    await expect(
      withConversationReadOperation(data, async scoped => {
        escaped = scoped;
        throw new Error('Synthetic failure');
      }),
    ).rejects.toThrow('Synthetic failure');
    expect(escaped.readHealthContext).toBe(data.readHealthContext);
    expect(escaped.summaryArtifactDiscovery).toBe(
      data.summaryArtifactDiscovery,
    );
  } finally {
    f.close();
  }
});
