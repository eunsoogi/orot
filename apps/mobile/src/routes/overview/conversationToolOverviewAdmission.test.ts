import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openOpSqliteFileQueue } from '../../../test-support/opSqliteFileQueueFixture';
import { createHealthContextTool } from '../../aiFeatures/integration/healthContextTool';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { createHealthContextReader } from '../../healthEvidence/healthContext/reader';
import { loadOverviewMetrics } from './metricLoader';

function gate() {
  let release!: () => void;
  const reached = new Promise<void>(resolve => {
    release = resolve;
  });
  return { release, reached };
}

test('an active Overview snapshot waits for the local tool transaction, not a pending provider', async () => {
  const fixture = openOpSqliteFileQueue();
  const localEntered = gate();
  const releaseLocal = gate();
  const overviewQueued = gate();
  const providerEntered = gate();
  const releaseProvider = gate();
  const now = new Date('2026-01-15T12:00:00Z');
  let localHeld = false;
  let overviewAdmitted = false;
  let providerPending = false;
  let local: Promise<unknown> | undefined;
  let overview: Promise<unknown> | undefined;
  const database: SqlDatabase = {
    ...fixture.database,
    transaction: work =>
      fixture.database.transaction(tx =>
        work({
          ...tx,
          execute: async (query, bindings) => {
            const result = await tx.execute(query, bindings);
            if (
              !localHeld &&
              query.includes('WITH days(date, from_key, to_key)')
            ) {
              localHeld = true;
              localEntered.release();
              await releaseLocal.reached;
            }
            return result;
          },
        }),
      ),
  };
  const overviewDatabase: SqlDatabase = {
    ...fixture.database,
    transaction(work) {
      const scheduled = fixture.database.transaction(tx => {
        overviewAdmitted = true;
        return work(tx);
      });
      overviewQueued.release();
      return scheduled;
    },
  };
  try {
    await runMigrations(fixture.database);
    const records = createRecordRepository(fixture.database);
    await records.put(
      'health_observation',
      healthObservation(
        'synthetic-heart-rate',
        'heart_rate',
        '2026-01-14T12:00:00Z',
      ),
    );
    const tool = createHealthContextTool(
      createHealthContextReader(database),
      new LocalEvidenceReferenceRegistry(),
      'rag',
    );
    local = (async () => {
      const result = await tool.search({
        input: {
          topics: ['measurements'],
          window: {
            fromInclusive: '2026-01-01T00:00:00Z',
            toExclusive: now.toISOString(),
            timeZone: 'UTC',
          },
        },
        operationRunId: 'synthetic',
        operationKey: 'tool',
        allowedScope: { sourceKinds: ['personal_record'] },
        resultLimit: 8,
        maxPayloadBytes: 1000000,
        executionLimits: 'unbounded',
        signal: new AbortController().signal,
      });
      if (!('items' in result)) throw new Error('Expected local evidence.');
      expect(result.items).toHaveLength(1);
      providerPending = true;
      providerEntered.release();
      await releaseProvider.reached;
      providerPending = false;
    })();
    await Promise.race([localEntered.reached, local]);
    expect(localHeld).toBe(true);
    const activeOverview = loadOverviewMetrics(overviewDatabase, now);
    overview = activeOverview;
    await Promise.race([overviewQueued.reached, activeOverview]);
    expect(overviewAdmitted).toBe(false);
    releaseLocal.release();
    await Promise.race([providerEntered.reached, local]);
    expect((await activeOverview).metrics.heartRate).toBeDefined();
    expect(overviewAdmitted).toBe(true);
    expect(providerPending).toBe(true);
    releaseProvider.release();
    await local;
    expect(providerPending).toBe(false);
  } finally {
    releaseLocal.release();
    releaseProvider.release();
    await Promise.allSettled([local, overview]);
    await fixture.close();
  }
});
