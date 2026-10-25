import { createRecordRepository, runMigrations } from '../src';
import type { HealthObservationCursor } from '../src';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
import { healthObservation } from './localQueryTestSupport';

test('pages a large SQLite library through tied timestamps without duplicates or omissions', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const expected: string[] = [];
    await repository.transaction(async (writer) => {
      for (let i = 0; i < 1203; i += 1) {
        const id = `sample-${String(i).padStart(4, '0')}`;
        expected.push(id);
        await writer.put(
          'health_observation',
          healthObservation(id, 'heart_rate', '2026-10-01T00:00:00.000Z'),
        );
      }
    });
    const seen: string[] = [];
    let cursor: HealthObservationCursor | null = null;
    do {
      const page = await repository.listHealthObservationPage(cursor, 50);
      expect(page.records.length).toBeLessThanOrEqual(50);
      seen.push(...page.records.map((record) => record.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(expected);
    await expect(repository.listHealthObservationPage(null, 101)).rejects.toThrow('page size');
  } finally {
    close();
  }
});

test('a cursor remains usable when its record is deleted and newer records arrive', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    for (const id of ['a', 'b', 'c']) {
      await repository.put(
        'health_observation',
        healthObservation(id, 'heart_rate', '2026-10-01T00:00:00.000Z'),
      );
    }
    const first = await repository.listHealthObservationPage(null, 2);
    await repository.delete('health_observation', 'b');
    await repository.put(
      'health_observation',
      healthObservation('new', 'heart_rate', '2026-10-02T00:00:00.000Z'),
    );
    const next = await repository.listHealthObservationPage(first.nextCursor, 2);
    expect(next.records.map((record) => record.id)).toEqual(['c']);
    expect(next.nextCursor).toBeNull();
  } finally {
    close();
  }
});
