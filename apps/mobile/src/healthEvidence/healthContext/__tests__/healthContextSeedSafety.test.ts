import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createHealthContextReader } from '../reader';
import { beginHealthContextReadOperation } from '../healthContextReadOperation';

const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-02T00:00:00Z',
  timeZone: 'UTC',
};

// Seeded reports are committed hints, never a substitute for live DB fences.
test('seed rejects cancellation and stale mutation/deletion, without writing scope results back', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const other = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    await runMigrations(other.database);
    const records = createRecordRepository(f.database);
    await records.put(
      'health_observation',
      healthObservation('one', 'heart_rate', '2026-10-01T10:00:00Z'),
    );
    const base = createHealthContextReader(f.database);
    await base(window, ['measurements']);
    const scope = beginHealthContextReadOperation(base)!;
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      scope.read(window, ['measurements'], cancelled.signal),
    ).rejects.toThrow('cancelled');
    await records.put(
      'health_observation',
      healthObservation('two', 'heart_rate', '2026-10-01T11:00:00Z'),
    );
    expect(
      (await scope.read(window, ['measurements'])).quantities[0]?.days[0]
        ?.samples,
    ).toBe(2);
    await records.delete('health_observation', 'one');
    expect(
      (await scope.read(window, ['measurements'])).quantities[0]?.days[0]
        ?.samples,
    ).toBe(1);
    const foreign = beginHealthContextReadOperation(
      createHealthContextReader(other.database),
    )!;
    expect((await foreign.read(window, ['measurements'])).quantities).toEqual(
      [],
    );
    foreign.dispose();
    scope.dispose();
    let aggregates = 0;
    await base(window, ['measurements'], undefined, (step, status) => {
      if (step === 'quantities' && status === 'started') aggregates++;
    });
    expect(aggregates).toBe(1); // Scoped refreshed entry did not replace stale base entry.
  } finally {
    f.close();
    other.close();
  }
});
