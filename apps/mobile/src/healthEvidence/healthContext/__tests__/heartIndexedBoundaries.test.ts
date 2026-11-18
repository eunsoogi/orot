import {
  createRecordRepository,
  runMigrations,
  type SqlExecutor,
} from '@orot/storage';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { addHeartRateActivityContext } from '../heartRateActivity';
import { healthContextDays } from '../window';
import { ensureHealthContextGeneration } from '../generation';
import { previousHeartCalendarSweep } from '../testSupport/heartRateActivityLegacySql';

/** Replay the former query against the same rows, including stale/cutoff and half-open edges. */
test.each([true, false])(
  'indexed heart days match the prior sweep with index=%s',
  async indexed => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(f.database);
      if (indexed) await ensureHealthContextGeneration(f.database);
      const repository = createRecordRepository(f.database);
      const from = '2026-03-08T05:00:00.0000001Z';
      const to = '2026-03-10T04:00:00.0000001Z';
      const cutoff = '2026-12-01T00:00:00.0000001Z';
      const times = [
        from.replace('0000001', '0000000'),
        from,
        '2026-03-09T04:00:00Z',
        to.replace('0000001', '0000000'),
        to,
      ];
      for (const [index, at] of [
        ...times,
        times[1]!,
        times[1]!,
        times[1]!,
      ].entries()) {
        await repository.put('health_observation', {
          ...healthObservation(
            `point-${index}`,
            'heart_rate',
            at,
            'healthkit',
            'imported',
            at,
          ),
          ingestedAt:
            index === 6 ? cutoff.replace('0000001', '0000002') : cutoff,
          value: {
            kind: 'quantity',
            amount: 60 + index / 10,
            unit: 'count/min',
          },
        });
      }
      await f.database.execute(
        "INSERT INTO transcript_artifact_staleness(transcript_id,artifact_kind,artifact_id,superseded_segment_id,current_segment_id,invalidated_at) VALUES ('t','health_observation','point-7','old','new','2026-12-02')",
      );
      const days = healthContextDays({
        fromInclusive: from,
        toExclusive: to,
        timeZone: 'America/New_York',
      });
      let sql = '';
      let parameters: Parameters<SqlExecutor['execute']>[1];
      const capture: SqlExecutor = {
        execute: async (query, values) => {
          sql = query;
          parameters = values;
          return f.database.execute(query, values);
        },
      };
      for (const workouts of [false, true]) {
        if (workouts)
          await repository.put('health_observation', {
            ...healthObservation(
              'interval',
              'workout_duration',
              '2026-03-08T04:00:00Z',
              'healthkit',
              'imported',
              '2026-03-09T04:00:00Z',
            ),
            ingestedAt: cutoff,
          });
        await addHeartRateActivityContext(
          capture,
          days,
          [
            {
              concept: 'heart_rate',
              unit: 'count/min',
              source: 'synthetic:',
              days: [],
            },
          ],
          undefined,
          cutoff,
        );
        const current = await f.database.execute(sql, parameters);
        const prior = await f.database.execute(
          previousHeartCalendarSweep(sql),
          parameters,
        );
        expect(current.rows).toEqual(prior.rows);
        expect(current.rows.reduce((n, r) => n + Number(r.samples), 0)).toBe(4);
        expect(current.rows.map(r => r.context)).toContain(
          workouts ? 'workout_overlap' : 'unknown',
        );
        if (indexed) {
          const plan = await f.database.execute(
            `EXPLAIN QUERY PLAN ${sql}`,
            parameters,
          );
          expect(
            plan.rows.some(row =>
              String(row.detail).includes(
                'SEARCH r USING INDEX health_context_quantity_time (<expr>=? AND <expr>>? AND <expr><?)',
              ),
            ),
          ).toBe(true);
        }
      }
      await f.database.execute('DELETE FROM health_observations WHERE id = ?', [
        'point-1',
      ]);
      expect((await f.database.execute(sql, parameters)).rows).toEqual(
        (await f.database.execute(previousHeartCalendarSweep(sql), parameters))
          .rows,
      );
      const controller = new AbortController();
      controller.abort();
      const execute = jest.fn();
      await expect(
        addHeartRateActivityContext(
          { execute },
          days,
          [
            {
              concept: 'heart_rate',
              unit: 'count/min',
              source: 'synthetic:',
              days: [],
            },
          ],
          controller.signal,
        ),
      ).rejects.toThrow('cancelled');
      expect(execute).not.toHaveBeenCalled();
    } finally {
      f.close();
    }
  },
);

test('the differential oracle fails closed when the query shape is unsupported', () => {
  expect(() => previousHeartCalendarSweep('SELECT 1')).toThrow(
    'differential oracle',
  );
});
