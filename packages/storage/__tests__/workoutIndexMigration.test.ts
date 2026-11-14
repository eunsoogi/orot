import { createRecordRepository, runMigrations } from '../src';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
import { healthObservation } from './localQueryTestSupport';

/** Existing payloads survive the index-only upgrade, including unrecognized future concepts. */
test('upgrades version sixteen without rewriting observations and uses the workout category index', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    const workout = healthObservation('saved-workout', 'workout_duration', '2026-10-20T00:00:00Z');
    workout.ingestedAt = '2026-10-21T00:00:00Z';
    await repository.put('health_observation', workout);
    await database.execute('DROP INDEX health_observations_library_workouts_idx');
    await database.execute(
      "CREATE INDEX health_observations_library_idx ON health_observations ((json_extract(payload_json, '$.concept')))",
    );
    await database.execute('PRAGMA user_version = 16');
    const before = (
      await database.execute('SELECT payload_json FROM health_observations WHERE id = ?', [
        workout.id,
      ])
    ).rows;
    await runMigrations(database);
    expect((await database.execute('PRAGMA user_version')).rows[0]?.user_version).toBe(17);
    expect(
      (
        await database.execute('SELECT payload_json FROM health_observations WHERE id = ?', [
          workout.id,
        ])
      ).rows,
    ).toEqual(before);
    const page = await repository.listHealthObservationPage(null, 10, {
      category: 'workouts',
      toInclusive: '2026-10-21T00:00:00Z',
    });
    expect(page.records.map((record) => record.id)).toEqual([workout.id]);
    await repository.delete('health_observation', workout.id);
    expect(
      (
        await repository.listHealthObservationPage(null, 10, {
          category: 'workouts',
          toInclusive: '2026-10-21T00:00:00Z',
        })
      ).records,
    ).toEqual([]);
    await runMigrations(database);
    expect(
      (await database.execute('SELECT COUNT(*) AS count FROM health_observations')).rows[0]?.count,
    ).toBe(0);
  } finally {
    close();
  }
});
