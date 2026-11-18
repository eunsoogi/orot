import type { SqlDatabase } from '@orot/storage';
import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';

/** Real SQLite plus the driver's FIFO transaction admission rule. Direct execute
 * is deliberately not queued: native per-query contention is outside this test. */
test('a second tab transaction waits for the complete history ancestry validation', async () => {
  const f = await diverseHistoryProfileFixture(6, true);
  const transaction = f.database.transaction.bind(f.database);
  let tail = Promise.resolve();
  const events: string[] = [];
  let aggregateSql = 0;
  let requestedAt = 0;
  let admittedAt = 0;
  let completedAt = 0;
  let historyEndedAt = 0;
  let probe: Promise<void> | undefined;
  const queued: SqlDatabase['transaction'] = operation => {
    const next = tail.then(() => transaction(operation));
    tail = next.catch(() => {});
    return next;
  };
  f.database.transaction = operation =>
    queued(async tx => {
      const execute = tx.execute.bind(tx);
      tx.execute = async (...args) => {
        if (/WITH days\(/.test(args[0])) {
          aggregateSql++;
          if (!probe) {
            requestedAt = performance.now();
            events.push('other-tab-requested');
            probe = queued(async other => {
              admittedAt = performance.now();
              events.push('other-tab-admitted');
              expect((await other.execute('SELECT 1 AS ready')).rows).toEqual([
                { ready: 1 },
              ]);
              completedAt = performance.now();
            });
          }
        }
        return execute(...args);
      };
      await operation(tx);
      historyEndedAt = performance.now();
      events.push('history-callback-ended');
    });
  try {
    const start = performance.now();
    const graph = await f.storage.readManyWithAncestry(
      Array.from({ length: 6 }, (_, i) => `turn-${i}`),
    );
    expect(graph.items.filter(Boolean)).toHaveLength(6);
    expect(probe).toBeDefined();
    await probe;
    expect(events).toEqual([
      'other-tab-requested',
      'history-callback-ended',
      'other-tab-admitted',
    ]);
    expect(admittedAt).toBeGreaterThanOrEqual(historyEndedAt);
    expect(aggregateSql).toBeGreaterThan(0);
    console.info(
      JSON.stringify({
        aggregateSql,
        historyMs: historyEndedAt - start,
        otherTabWaitMs: admittedAt - requestedAt,
        otherTabReadMs: completedAt - admittedAt,
      }),
    );
  } finally {
    await tail;
    f.database.transaction = transaction;
    f.close();
  }
});
