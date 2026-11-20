import {
  createRecordRepository,
  runMigrations,
  type SqlDatabase,
} from '@orot/storage';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { loadOverviewMetrics } from './metricLoader';

const scenarios = ['quantity', 'one-week', 'matched', 'mixed'] as const;

test('sleep source comparison only reads storage when both complete weeks are observed', async () => {
  for (const scenario of scenarios) {
    const fixture = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(fixture.database);
      const records = createRecordRepository(fixture.database);
      await records.put('health_observation', {
        ...healthObservation(
          'synthetic-heart',
          'heart_rate',
          '2026-10-14T11:00:00Z',
        ),
        ingestedAt: '2026-10-15T10:00:00Z',
      });
      const sleep = async (date: string, device: string) => {
        const record = healthObservation(
          'synthetic-' + date,
          'HKCategoryTypeIdentifierSleepAnalysis',
          date + 'T01:00:00Z',
          'healthkit',
          'imported',
          date + 'T02:00:00Z',
        );
        await records.put('health_observation', {
          ...record,
          ingestedAt: '2026-10-15T10:00:00Z',
          provenance: {
            ...record.provenance,
            source: {
              system: 'healthkit',
              sourceIdentifier: device,
              sourceName: device,
            },
          },
        });
      };
      if (scenario !== 'quantity') await sleep('2026-10-14', 'synthetic-watch');
      if (scenario === 'matched' || scenario === 'mixed')
        await sleep(
          '2026-10-03',
          scenario === 'matched' ? 'synthetic-watch' : 'synthetic-phone',
        );

      let sourceQueries = 0;
      const traced: SqlDatabase = {
        ...fixture.database,
        transaction: operation =>
          fixture.database.transaction(tx =>
            operation({
              ...tx,
              execute(sql, params) {
                if (sql.includes("SELECT 'previous' AS period"))
                  sourceQueries++;
                return tx.execute(sql, params);
              },
            }),
          ),
      };
      const { metrics } = await loadOverviewMetrics(
        traced,
        new Date('2026-10-15T12:00:00Z'),
      );
      expect(metrics.heartRate).toBeDefined();
      if (scenario === 'quantity') expect(metrics.sleep).toBeUndefined();
      else expect(metrics.sleep?.latest.value).toBe(60);
      if (scenario === 'matched')
        expect(Boolean(metrics.sleep?.comparison)).toBe(true);
      else if (scenario !== 'quantity')
        expect(metrics.sleep?.comparison).toBeNull();
      expect(sourceQueries).toBe(
        scenario === 'matched' || scenario === 'mixed' ? 1 : 0,
      );
      if (scenario === 'matched') {
        await records.delete('health_observation', 'synthetic-2026-10-03');
        const afterDeletion = await loadOverviewMetrics(
          traced,
          new Date('2026-10-15T12:00:00Z'),
        );
        expect(afterDeletion.metrics.sleep?.comparison).toBeNull();
        expect(afterDeletion.metrics.sleep?.latest.value).toBe(60);
        expect(sourceQueries).toBe(1);
      }
    } finally {
      fixture.close();
    }
  }
});
