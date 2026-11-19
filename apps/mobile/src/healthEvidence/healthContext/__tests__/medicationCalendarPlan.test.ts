import {
  createRecordRepository,
  localQueryTimestampKey,
  localQueryTimestampKeyExpression,
  runMigrations,
} from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  importedDoseEvent,
  medicationDefinition,
} from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { ensureHealthContextGeneration } from '../generation';
import { readHealthMedicationContext } from '../medicationQuery';

/** Check the loop order with real SQLite, and compare ordered rows with the
 * previous join across offset, cutoff and staleness boundaries. */
test('seeks the dose index once per calendar day without changing medication statistics', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    await ensureHealthContextGeneration(database);
    const records = createRecordRepository(database);
    await records.put(
      'medication_definition',
      medicationDefinition('medication-1', '2023-03-11T00:00:00Z'),
    );
    for (const [id, at, status, ingestedAt] of [
      ['before-start', '2023-03-12T05:00:00.0004Z', 'taken'],
      ['at-start', '2023-03-12T00:00:00.0005-05:00', 'taken'],
      ['before-midnight', '2023-03-13T03:59:59.9999Z', 'taken'],
      ['at-midnight', '2023-03-13T00:00:00-04:00', 'skipped'],
      ['stale', '2023-03-14T04:00:00Z', 'taken'],
      ['late-ingest', '2023-03-15T04:00:00Z', 'taken', '2027-04-01T00:00:00Z'],
      ['at-end', '2027-03-11T05:00:00Z', 'taken'],
    ] as const) {
      await records.put('dose_event', {
        ...importedDoseEvent(id, at, status),
        ingestedAt: ingestedAt ?? '2027-03-20T00:00:00Z',
      });
    }
    await database.execute(
      'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'transcript',
        'dose_event',
        'stale',
        'old',
        'current',
        '2027-03-20T00:00:00Z',
      ],
    );

    const fromInclusive = '2023-03-12T00:00:00.0005-05:00';
    const toExclusive = '2027-03-11T00:00:00-05:00';
    const at = localQueryTimestampKeyExpression('d.effective_at');
    for (const dataAvailableThrough of [undefined, '2027-03-20T00:00:00Z']) {
      let queryCount = 0;
      const result = await readHealthMedicationContext(
        {
          execute: async (query, bindings = []) => {
            queryCount++;
            const plan = await database.execute(
              `EXPLAIN QUERY PLAN ${query}`,
              bindings,
            );
            const details = plan.rows.map(row => String(row.detail));
            const loops = details.filter(
              detail =>
                detail.includes('SCAN json_each') ||
                detail.includes(
                  'SEARCH d USING INDEX health_context_dose_time',
                ),
            );
            expect(loops).toEqual([
              expect.stringContaining('SCAN json_each'),
              expect.stringMatching(
                /SEARCH d USING INDEX health_context_dose_time \(.+>\? AND .+<\?\)/,
              ),
            ]);

            const previous = query
              .replace(
                'FROM days day CROSS JOIN dose_events d ON',
                'FROM dose_events d JOIN days day ON',
              )
              .replace(
                '\n      WHERE NOT EXISTS',
                `\n      WHERE ${at} >= ? AND ${at} < ? AND NOT EXISTS`,
              );
            expect(previous).not.toBe(query);
            const previousBindings = bindings.slice();
            previousBindings.splice(
              dataAvailableThrough
                ? previousBindings.length - 1
                : previousBindings.length,
              0,
              localQueryTimestampKey(fromInclusive),
              localQueryTimestampKey(toExclusive),
            );
            const actual = await database.execute(query, bindings);
            expect(actual).toEqual(
              await database.execute(previous, previousBindings),
            );
            return actual;
          },
        },
        {
          fromInclusive,
          toExclusive,
          timeZone: 'America/New_York',
          ...(dataAvailableThrough ? { dataAvailableThrough } : {}),
        },
      );
      expect(queryCount).toBe(1);
      expect(result.medications).toEqual([
        expect.objectContaining({
          identity: 'medication-1',
          taken: dataAvailableThrough ? 2 : 3,
          skipped: 1,
          otherDoseRecords: 0,
          daysWithDoseRecords: dataAvailableThrough ? 2 : 3,
          firstDoseAt: '2023-03-12T00:00:00.0005-05:00',
          lastDoseAt: dataAvailableThrough
            ? '2023-03-13T00:00:00-04:00'
            : '2023-03-15T04:00:00Z',
        }),
      ]);
    }
  } finally {
    close();
  }
});
