import { HealthObservationSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  createDailyReportCalendarWindow,
  currentDailyReportContextRequest,
} from '../dailyReportWindow';
import { readDailyReportSnapshot } from '../dailyReportSnapshot';

/** Real SQLite, synthetic data: requesting today after midnight never silently borrows yesterday. */
test('a new local day has no current measurements until an eligible sample arrives', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const request = currentDailyReportContextRequest(
      '2035-01-01T15:03:00Z',
      'Asia/Seoul',
    );
    if (request.status !== 'ready') throw new Error('Invalid fixture');
    expect(request.request.localDate).toBe('2035-01-02');
    const window = createDailyReportCalendarWindow(request.request);
    if (window.status !== 'ready') throw new Error('Invalid fixture');
    expect(window.context.interval.fromInclusive).toBe(
      '2035-01-01T15:00:00.000Z',
    );
    const repository = createRecordRepository(db.database);
    const put = (id: string, at: string) =>
      repository.put(
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
    await put('yesterday-only', '2035-01-01T14:59:00Z');
    const empty = await readDailyReportSnapshot(
      db.database,
      window.context,
      {},
    );
    expect(empty.values).toEqual([]);
    await put('today', '2035-01-01T15:01:00Z');
    const today = await readDailyReportSnapshot(
      db.database,
      window.context,
      {},
    );
    expect(today.values.map(value => value.record.id)).toEqual(['today']);
    expect(
      (
        await readDailyReportSnapshot(db.database, window.context, {
          sourceIds: [],
        })
      ).values,
    ).toEqual([]);
  } finally {
    db.close();
  }
});
