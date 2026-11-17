import { diverseHistoryProfileFixture } from '../testSupport/diverseHistoryProfileFixture';
import * as hydration from '../restoreConversationArtifact';
import * as reader from '../../../healthEvidence/healthContext/reader';

// Timings are local synthetic observations, not device benchmarks. Counts identify
// where distinct period scopes and nested source restoration repeat strict checks.
// reports counts the exported strict reader; aggregateSql also captures private
// reader closures used to rebuild source presentation (including cache misses).
test.each(
  [1, 4, 10].flatMap(count => [false, true].map(nested => ({ count, nested }))),
)(
  'profiles distinct scope/ancestry restoration $count/$nested',
  async ({ count, nested }) => {
    const f = await diverseHistoryProfileFixture(count, nested);
    const stages: Record<
      string,
      {
        calls: number;
        ms: number;
        reports: number;
        sql: number;
        aggregateSql: number;
        transactions: number;
      }
    > = {};
    let stage = 'metadata';
    const row = () =>
      (stages[stage] ??= {
        calls: 0,
        ms: 0,
        reports: 0,
        sql: 0,
        aggregateSql: 0,
        transactions: 0,
      });
    const countSql = (query: string) => {
      row().sql++;
      if (/WITH days\(/.test(query)) row().aggregateSql++;
    };
    const direct = f.database.execute.bind(f.database);
    jest.spyOn(f.database, 'execute').mockImplementation((...args) => {
      countSql(args[0]);
      return direct(...args);
    });
    const transaction = f.database.transaction.bind(f.database);
    let tail = Promise.resolve();
    f.database.transaction = operation => {
      const run = tail.then(() =>
        transaction(async tx => {
          row().transactions++;
          const execute = tx.execute.bind(tx);
          tx.execute = async (...args) => {
            countSql(args[0]);
            return execute(...args);
          };
          await operation(tx);
        }),
      );
      tail = run.catch(() => {});
      return run;
    };
    const report = reader.readHealthContextReport;
    jest
      .spyOn(reader, 'readHealthContextReport')
      .mockImplementation(async (...args) => {
        row().reports++;
        return report(...args);
      });
    const measure = async <T>(name: string, work: () => Promise<T>) => {
      const previous = stage;
      stage = name;
      const stats = row();
      stats.calls++;
      // Nested snapshots stay in the same stage; do not double-count wall time.
      if (previous === name) return work();
      const start = performance.now();
      try {
        return await work();
      } finally {
        stats.ms += performance.now() - start;
        stage = previous;
      }
    };
    const initial = f.storage.readManyWithAncestry.bind(f.storage);
    jest
      .spyOn(f.storage, 'readManyWithAncestry')
      .mockImplementation(ids => measure('snapshot', () => initial(ids)));
    const readMany = f.storage.readMany.bind(f.storage);
    jest
      .spyOn(f.storage, 'readMany')
      .mockImplementation(ids => measure('recheck', () => readMany(ids)));
    const hydrate = hydration.restoreConversationArtifactSnapshot;
    jest
      .spyOn(hydration, 'restoreConversationArtifactSnapshot')
      .mockImplementation((...args) =>
        measure('hydrate', () => hydrate(...args)),
      );
    try {
      const start = performance.now();
      const page = await f.discovery.readSession({
        sessionId: 'session',
        signal: new AbortController().signal,
      });
      expect(page.items).toHaveLength(count);
      expect(page.unavailableCount).toBe(0);
      expect(stages.snapshot!.reports).toBe(count);
      expect(stages.recheck!.reports).toBe(count);
      // Parent hydration no longer repeats singleton database ancestry validation.
      expect(stages.hydrate!.reports).toBe(0);
      console.info(
        'SYNTHETIC_DIVERSE_HISTORY',
        JSON.stringify({
          count,
          nested,
          ms: performance.now() - start,
          stages,
        }),
      );
    } finally {
      jest.restoreAllMocks();
      f.database.transaction = transaction;
      f.close();
    }
  },
);
