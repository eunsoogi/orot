import {
  createDailyReportIdentity,
  HealthObservationSchema,
} from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createDailyReportStorage } from '../../../storage/dailyReportStorage';
import { previewDailyReport } from '../dailyReportPreview';

test('preparation reads only the selected current day through its cutoff', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const identity = createDailyReportIdentity('2035-01-01', 'UTC');
    await createDailyReportStorage(connection.database).lookup(identity);
    const repo = createRecordRepository(connection.database);
    for (const [id, at] of [
      ['inside', '2035-01-01T08:00:00Z'],
      ['later', '2035-01-01T13:00:00Z'],
      ['yesterday', '2034-12-31T20:00:00Z'],
    ]) {
      await repo.put(
        'health_observation',
        HealthObservationSchema.parse({
          id,
          effectiveAt: at,
          recordedAt: at,
          ingestedAt: at,
          provenance: { origin: 'user_reported', sourceRecordIds: [] },
          reviewState: { status: 'unreviewed' },
          observationKind: 'measurement',
          concept: 'heart_rate',
          value: { kind: 'quantity', amount: 72, unit: 'count/min' },
        }),
      );
    }
    const openDatabase = jest.fn(async () => connection.database);
    const result = await previewDailyReport({
      identity,
      currentTimeZone: 'UTC',
      now: '2035-01-01T12:00:00Z',
      openDatabase,
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      status: 'ready',
      count: 1,
      partial: true,
      latestSourceTime: '2035-01-01T08:00:00Z',
    });
    const old = createDailyReportIdentity('2034-12-31', 'UTC');
    expect(
      await previewDailyReport({
        identity: old,
        currentTimeZone: 'UTC',
        now: '2035-01-01T12:00:00Z',
        openDatabase,
        signal: new AbortController().signal,
      }),
    ).toEqual({ status: 'not_today' });
    expect(openDatabase).toHaveBeenCalledTimes(1);
    expect(
      await previewDailyReport({
        identity,
        currentTimeZone: 'Asia/Seoul',
        now: '2035-01-01T12:00:00Z',
        openDatabase,
        signal: new AbortController().signal,
      }),
    ).toEqual({ status: 'not_today' });
    expect(openDatabase).toHaveBeenCalledTimes(1);
  } finally {
    connection.close();
  }
});
