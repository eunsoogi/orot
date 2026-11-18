import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { sharedAncestryProfileFixture } from '../testSupport/sharedAncestryProfileFixture';
import { conversationHistoryPageOption } from '../conversationHistoryPageOption';
import { registerConversationReadOperation } from '../conversationReadOperation';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';

/** Exercise the shipping local-data surface, not a directly injected reader that
 * can conceal ownership lost by an adapter wrapper. */
test.each([
  [1, false],
  [3, false],
  [6, true],
] as const)('profiles %i periods with DAG=%s', async (count, dag) => {
  const f = await sharedAncestryProfileFixture(count, dag);
  const transaction = f.database.transaction.bind(f.database);
  const data = await f.input.loadLocalData();
  data.readHealthContext = createLocalEvidenceData(
    f.database,
  ).readHealthContext;
  registerConversationReadOperation(data, async (scoped, registry) =>
    createSummaryArtifactDiscovery({
      database: f.database,
      storage: createSymptomSummaryStorage(f.database),
      data: scoped,
      registry,
    }),
  );
  let stats = {
    aggregateSql: 0,
    aggregateMs: 0,
    waitMs: 0,
    sourceChecks: 0,
    sql: 0,
  };
  let periods: Record<string, number> = {};
  let sourceOrder: string[] = [];
  f.database.transaction = work => {
    const queued = Date.now();
    return transaction(async tx => {
      stats.waitMs += Date.now() - queued;
      const execute = tx.execute.bind(tx);
      tx.execute = async (...args) => {
        const aggregate = /WITH days\(/.test(args[0]);
        const start = Date.now();
        const result = await execute(...args);
        stats.sql++;
        if (aggregate) {
          stats.aggregateSql++;
          stats.aggregateMs += Date.now() - start;
          const key = JSON.stringify(args[1]);
          periods[key] = (periods[key] ?? 0) + 1;
        }
        if (
          args[0] ===
          'SELECT result_json FROM symptom_summary_runs WHERE id = ?'
        ) {
          stats.sourceChecks++;
          sourceOrder.push(String(args[1]?.[0]));
        }
        return result;
      };
      await work(tx);
    });
  };
  let sequence = 0;
  const cold = () =>
    f.repository.put('health_observation', {
      ...f.inside,
      id: `future-${sequence++}`,
      effectiveAt: '2027-01-01T00:00:00Z',
      ingestedAt: '2027-01-01T00:00:00Z',
      recordedAt: '2027-01-01T00:00:00Z',
    });
  const measurements: Record<string, unknown> = {};
  const measure = async <T>(name: string, work: () => Promise<T>) => {
    stats = {
      aggregateSql: 0,
      aggregateMs: 0,
      waitMs: 0,
      sourceChecks: 0,
      sql: 0,
    };
    periods = {};
    sourceOrder = [];
    const start = Date.now();
    const result = await work();
    measurements[name] = {
      ...stats,
      elapsedMs: Date.now() - start,
      exactParameterRepeatCounts: Object.values(periods),
    };
    return result;
  };
  try {
    const signal = new AbortController().signal;
    await cold();
    const version = (await f.discovery.activeSessionVersion('session'))!;
    const page = await measure('discovery', () =>
      f.discovery.readSession({ sessionId: 'session', signal }),
    );
    const discoverySql = stats.aggregateSql;
    expect(discoverySql).toBe(2 * count); // Both exact database owners share one committed report.
    await measure('revalidateOne', () =>
      f.discovery.revalidateSession('session', version, page.items, signal),
    );
    expect(stats.aggregateSql).toBe(2 * count);
    await measure('revalidateTwo', () =>
      f.discovery.revalidateSession('session', version, page.items, signal),
    );
    expect(stats.aggregateSql).toBe(2 * count);
    await cold();
    const strictInput = {
      ...f.input,
      loadLocalData: async () => ({
        ...data,
        conversationArtifactDiscovery: async () => ({ ...f.discovery }),
      }),
    };
    await measure('strictHistory', () =>
      conversationHistoryPageOption(strictInput, f.open)('session', signal),
    );
    expect(stats.aggregateSql).toBe(6 * count);
    const strictOrder = [...sourceOrder];
    await cold();
    const history = await measure('wholeHistory', () =>
      conversationHistoryPageOption(f.input, f.open)('session', signal),
    );
    expect(history.turns).toHaveLength(Math.min(10, dag ? count * 2 : count));
    expect(stats.aggregateSql).toBe(2 * count);
    expect(sourceOrder).toEqual(strictOrder);
    console.info(
      'SYNTHETIC_STARTUP_SHARED_PERIODS',
      JSON.stringify({ count, dag, ...measurements }),
    );
  } finally {
    f.database.transaction = transaction;
    f.close();
  }
});
