import { createRecordRepository, runMigrations } from '@orot/storage';
import { importedDoseEvent } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { createHealthEvidenceTestDatabase } from '../../localEvidenceTestSupport';
import { readDoseHistory } from '../doseHistoryQuery';

test('continues real SQLite dose pages beyond the former total-page ceiling', async () => {
  const { database, close } = createHealthEvidenceTestDatabase();
  try {
    await runMigrations(database);
    const records = createRecordRepository(database);
    for (let index = 0; index < 1003; index++) {
      await records.put(
        'dose_event',
        importedDoseEvent(
          `dose-${String(index).padStart(4, '0')}`,
          new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
          'taken',
        ),
      );
    }
    const window = {
      fromInclusive: '2026-01-01T00:00:00Z',
      toExclusive: '2026-01-02T00:00:00Z',
      timeZone: 'UTC',
      doseHistory: { page: 1001, pageSize: 1 },
    };
    const result = await readDoseHistory(database, window);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.effectiveAt).toBe('2026-01-01T00:16:41.000Z');
    expect(result.hasMore).toBe(true);
    const last = await readDoseHistory(database, {
      ...window,
      doseHistory: { page: 1002, pageSize: 1 },
    });
    expect(last.records).toHaveLength(1);
    expect(last.hasMore).toBe(false);
    // Safe integer offsets are a representation boundary, not a data quota.
    await expect(
      readDoseHistory(database, {
        ...window,
        doseHistory: { page: Number.MAX_SAFE_INTEGER, pageSize: 20 },
      }),
    ).rejects.toThrow('Invalid dose history selection');
  } finally {
    close();
  }
});
