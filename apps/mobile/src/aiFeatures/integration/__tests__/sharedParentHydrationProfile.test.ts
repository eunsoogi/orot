import { createConversationPageHydration } from '../conversationPageHydration';
import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';

/** Synthetic SQLite; measure hydration only after the strict graph read, not
 * device latency or provider dispatch. Production readers remain unmodified. */
test.each([
  { count: 1, dag: false },
  { count: 3, dag: false },
  { count: 6, dag: false },
  { count: 6, dag: true },
])('profiles $count roots dag=$dag', async ({ count, dag }) => {
  const f = await sharedAncestryProfileFixture(count, dag);
  const data = await f.input.loadLocalData();
  const original = data.summaryArtifactDiscovery!;
  const reads: Record<string, number> = {};
  data.summaryArtifactDiscovery = async registry => {
    const discovery = await original(registry);
    return {
      ...discovery,
      read: async (id, signal) => {
        reads[id] = (reads[id] ?? 0) + 1;
        return discovery.read(id, signal);
      },
    };
  };
  const ids = Array.from(
    { length: count },
    (_, i) => `${dag ? 'dag-' : ''}turn-${i}`,
  );
  const graph = await f.storage.readManyWithAncestry(ids);
  const execute = f.database.execute.bind(f.database);
  const transaction = f.database.transaction.bind(f.database);
  let aggregateSql = 0;
  let transactions = 0;
  const observe = (sql: string) => {
    if (/WITH days\(/.test(sql)) aggregateSql++;
  };
  f.database.execute = async (...args) => {
    observe(args[0]);
    return execute(...args);
  };
  f.database.transaction = async operation =>
    transaction(async tx => {
      transactions++;
      const run = tx.execute.bind(tx);
      tx.execute = async (...args) => {
        observe(args[0]);
        return run(...args);
      };
      await operation(tx);
    });
  try {
    const hydrate = createConversationPageHydration(
      {
        storage: f.storage,
        data,
        registry: f.input.registry,
        signal: new AbortController().signal,
      },
      graph.ancestry,
    );
    for (const id of ids) expect(await hydrate(id)).not.toBeNull();
    expect(Object.values(reads).reduce((a, b) => a + b, 0)).toBe(
      dag ? 2 ** count - 1 : (count * (count + 1)) / 2,
    );
    expect(reads['summary-0']).toBe(dag ? 2 ** (count - 1) : count);
    console.info(
      JSON.stringify({ count, dag, reads, aggregateSql, transactions }),
    );
  } finally {
    data.summaryArtifactDiscovery = original;
    f.database.execute = execute;
    f.database.transaction = transaction;
    f.close();
  }
});
