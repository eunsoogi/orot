import { createRecordRepository, runMigrations } from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { ensureHealthContextGeneration } from '../generation';
import { addHeartRateActivityContext } from '../heartRateActivity';
import {
  nativeHeartWorkoutPrefix,
  releaseHeartWorkoutPrefix,
} from '../heartWorkoutPrefix';
import { readHealthQuantityContext } from '../quantityQuery';
import { healthContextDays } from '../window';

/** The timeline oracle independently handles ties, overlaps and stale markers. */
test('indexed workout predecessors preserve nested intervals, equal-time events and missing workout context', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await f.database.execute('PRAGMA temp_store = MEMORY');
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    const records = createRecordRepository(f.database);
    for (const [id, kind, from, to] of [
      ['long', 'workout_duration', '06:05:00', '06:50:00'],
      ['nested', 'workout_duration', '06:20:00', '06:30:00'],
      ['later', 'workout_duration', '07:00:00', '07:40:00'],
      ['stale-workout', 'workout_duration', '06:55:00', '07:00:00'],
      ['nested-heart', 'heart_rate', '06:40:00', '06:40:00'],
      ['interval-at-start', 'heart_rate', '06:55:00', '07:00:00'],
      ['point-at-start', 'heart_rate', '07:00:00', '07:00:00'],
      ['outside-window', 'heart_rate', '07:30:00', '07:45:00'],
    ] as const) {
      const start = `2026-03-08T${from}Z`;
      const end = `2026-03-08T${to}Z`;
      await records.put('health_observation', {
        ...healthObservation(id, kind, start, 'healthkit', 'imported', end),
        ingestedAt: end,
      });
    }
    await f.database.execute(
      "INSERT INTO transcript_artifact_staleness(transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES ('t','health_observation','stale-workout','old','new','2026-03-10')",
    );
    const days = healthContextDays({
      fromInclusive: '2026-03-08T00:00:00-05:00',
      toExclusive: '2026-03-08T03:40:00-04:00',
      timeZone: 'America/New_York',
    });
    const stop = '2026-03-09T00:00:00Z';
    const { series } = await readHealthQuantityContext(
      f.database,
      days,
      undefined,
      'measurements',
      stop,
    );
    for (const remove of [false, true]) {
      if (remove)
        await f.database.execute(
          "DELETE FROM health_observations WHERE id IN ('long','nested','later')",
        );
      const expected = await addHeartRateActivityContext(
        f.database,
        days,
        series,
        undefined,
        stop,
      );
      await f.database.transaction(async tx => {
        const actual = await addHeartRateActivityContext(
          tx,
          days,
          series,
          undefined,
          stop,
          async () => releaseHeartWorkoutPrefix(tx),
        );
        expect(actual).toEqual(expected);
        expect(
          (
            await tx.execute(
              "SELECT name FROM sqlite_temp_schema WHERE name='orot_heart_workout_prefix'",
            )
          ).rows,
        ).toEqual([]);
      });
      expect(
        expected[0]?.days[0]?.activityContext?.map(group => [
          group.context,
          group.samples,
        ]),
      ).toEqual(
        remove
          ? [['unknown', 4]]
          : [
              ['no_recorded_workout_overlap', 1],
              ['unknown', 1],
              ['workout_overlap', 2],
            ],
      );
    }
  } finally {
    f.close();
  }
});

test('prepared TEMP workout rows are removed when the protected aggregate aborts', async () => {
  const f = openSqliteTestDatabase(':memory:');
  const cancellation = new Error('Synthetic cancellation');
  try {
    await f.database.execute('PRAGMA temp_store = MEMORY');
    await runMigrations(f.database);
    await ensureHealthContextGeneration(f.database);
    const age = '2026-03-08T05:00:00Z';
    const records = createRecordRepository(f.database);
    await records.put('health_observation', {
      ...healthObservation('heart', 'heart_rate', age),
      ingestedAt: age,
    });
    const days = healthContextDays({
      fromInclusive: age,
      toExclusive: '2026-03-09T00:00:00Z',
      timeZone: 'UTC',
    });
    const { series } = await readHealthQuantityContext(f.database, days);
    await f.database.transaction(async tx => {
      await expect(
        addHeartRateActivityContext(
          {
            async execute(query, bindings) {
              if (
                query.startsWith('INSERT INTO temp.orot_heart_workout_prefix')
              ) {
                await tx.execute(query, bindings);
                throw cancellation;
              }
              return tx.execute(query, bindings);
            },
          },
          days,
          series,
          undefined,
          undefined,
          async () => releaseHeartWorkoutPrefix(tx),
        ),
      ).rejects.toBe(cancellation);
      expect(
        (
          await tx.execute(
            "SELECT name FROM sqlite_temp_schema WHERE name='orot_heart_workout_prefix'",
          )
        ).rows,
      ).toEqual([]);
    });
  } finally {
    f.close();
  }
});

test('memory workspace capability leaves a shared SQLite pragma unchanged', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await f.database.execute('PRAGMA temp_store = FILE');
    const before = await f.database.execute('PRAGMA temp_store');
    await f.database.transaction(async tx => {
      const options = await tx.execute('PRAGMA compile_options');
      const compileTimeMemory = options.rows.some(
        row => row.compile_options === 'TEMP_STORE=3',
      );
      const acquire = nativeHeartWorkoutPrefix(tx, tx);
      const acquired = await acquire();
      expect(Boolean(acquired)).toBe(compileTimeMemory);
      expect(await acquire()).toBeUndefined();
      await acquired?.();
      const following = await acquire();
      expect(Boolean(following)).toBe(compileTimeMemory);
      await following?.();
    });
    expect(await f.database.execute('PRAGMA temp_store')).toEqual(before);
  } finally {
    f.close();
  }
});

test('two calculations cannot acquire the same transaction workspace concurrently', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await f.database.execute('PRAGMA temp_store = MEMORY');
    await f.database.transaction(async tx => {
      // Exercise the pinned iOS capability on this disposable memory-only DB.
      const execute = jest.fn(async () => ({
        rows: [{ compile_options: 'TEMP_STORE=3' }],
      }));
      const acquire = nativeHeartWorkoutPrefix({ execute }, tx);
      const [first, second] = await Promise.all([acquire(), acquire()]);
      expect(first).toBeDefined();
      expect(second).toBeUndefined();
      await first!();
      const following = await acquire();
      expect(following).toBeDefined();
      await following!();
      expect(execute).toHaveBeenCalledTimes(1);
    });
  } finally {
    f.close();
  }
});
