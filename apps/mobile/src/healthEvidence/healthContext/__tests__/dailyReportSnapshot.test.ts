import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { createDailyReportContext } from '../dailyReportContext';
import { createDailyReportCalendarWindow } from '../dailyReportWindow';
import { readDailyReportSnapshot } from '../dailyReportSnapshot';

test('a concurrent correction cannot mix values and revisions and rejects the old save', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createDailyReportStorage(connection.database);
    const calendar = createDailyReportCalendarWindow({
      localDate: '2035-01-01',
      timeZone: 'UTC',
      requestedAt: '2035-01-01T12:00:00Z',
    });
    if (calendar.status !== 'ready') throw new Error('Invalid fixture');
    await store.lookup(calendar.context.identity);
    const repository = createRecordRepository(connection.database);
    const observation = HealthObservationSchema.parse({
      id: 'synthetic',
      effectiveAt: '2035-01-01T01:00:00Z',
      recordedAt: '2035-01-01T01:00:00Z',
      ingestedAt: '2035-01-01T01:00:00Z',
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
      observationKind: 'measurement',
      concept: 'heart_rate',
      value: { kind: 'quantity', amount: 72, unit: 'count/min' },
    });
    await repository.put('health_observation', observation);
    let correction: Promise<unknown> | undefined;
    const database: SqlDatabase = {
      execute: connection.database.execute,
      transaction: operation =>
        connection.database.transaction(tx =>
          operation({
            ...tx,
            async execute(query, parameters) {
              const result = await tx.execute(query, parameters);
              if (
                !correction &&
                query.includes('FROM health_observations r WHERE')
              ) {
                correction = repository.put('health_observation', {
                  ...observation,
                  value: { kind: 'quantity', amount: 99, unit: 'count/min' },
                });
              }
              return result;
            },
          }),
        ),
    };
    const old = await readDailyReportSnapshot(database, calendar.context, {});
    await correction;
    expect(old.values[0]).toMatchObject({ record: { value: { amount: 72 } } });
    const context = createDailyReportContext(
      calendar.context,
      old.sourceSnapshot,
      { providerId: 'local', modelId: 'fixture' },
    );
    const result = {
      status: 'completed',
      report: {
        schemaVersion: 1,
        identity: context.identity,
        generatedAt: '2035-01-01T12:01:00Z',
        observations: [],
        supportedContext: [],
        coverage: context.sourceSnapshot.coverage,
        followUpQuestions: [],
      },
    };
    expect(
      (
        await store.save({
          runId: 'old',
          context,
          result,
          lineage: old.lineage,
          mode: { kind: 'initial' },
        })
      ).status,
    ).toBe('stale');
    const fresh = await readDailyReportSnapshot(
      connection.database,
      calendar.context,
      {},
    );
    expect(fresh.values[0]).toMatchObject({
      record: { value: { amount: 99 } },
    });
    expect(fresh.lineage[0]?.revision).not.toBe(old.lineage[0]?.revision);
    const newContext = createDailyReportContext(
      calendar.context,
      fresh.sourceSnapshot,
      { providerId: 'local', modelId: 'fixture' },
    );
    const newResult = {
      ...result,
      report: {
        ...result.report,
        identity: newContext.identity,
        coverage: newContext.sourceSnapshot.coverage,
      },
    };
    expect(
      (
        await store.save({
          runId: 'new',
          context: newContext,
          result: newResult,
          lineage: fresh.lineage,
          mode: { kind: 'initial' },
        })
      ).status,
    ).toBe('saved');
  } finally {
    connection.close();
  }
});
