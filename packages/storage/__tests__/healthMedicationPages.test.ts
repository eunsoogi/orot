import { createRecordRepository, runMigrations } from '../src';
import { readHealthMedicationPage } from '../src/healthMedicationPages';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
import { importedDoseEvent, medicationDefinition } from './localQueryTestSupport';

test('pages a large medication history with scalar totals and only the current page names', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    await repository.put(
      'medication_definition',
      medicationDefinition('medication-1', '2026-10-01T00:00:00Z'),
    );
    await repository.put(
      'medication_definition',
      medicationDefinition('without-logs', '2026-10-01T00:00:00Z'),
    );
    const template = {
      ...importedDoseEvent('dose-template', '2026-10-01T08:00:00Z', 'taken'),
      ingestedAt: '2026-10-22T00:00:00Z',
    };
    await database.execute(
      `WITH RECURSIVE samples(n) AS (SELECT 0 UNION ALL SELECT n + 1 FROM samples WHERE n < 19999)
      INSERT INTO dose_events (id, effective_at, recorded_at, ingested_at, payload_json)
      SELECT printf('dose-%05d', n), ?, ?, ?, json_set(?, '$.id', printf('dose-%05d', n)) FROM samples`,
      [template.effectiveAt, template.recordedAt, template.ingestedAt, JSON.stringify(template)],
    );
    let statement = '';
    let parameters: Parameters<typeof database.execute>[1];
    const request = { toInclusive: '2026-10-20T00:00:00Z', includeTotals: true };
    const queriedAt = Date.now();
    const page = await readHealthMedicationPage(
      {
        execute: (sql, values) => {
          if (sql.startsWith('SELECT payload_json FROM dose_events')) {
            statement = sql;
            parameters = values;
          }
          return database.execute(sql, values);
        },
      },
      request,
    );
    const queryMs = Date.now() - queriedAt;
    expect(page.doseEvents).toHaveLength(100);
    expect(page.definitions.map((item) => item.id)).toEqual(['medication-1']);
    expect(page.totalDefinitions).toBe(2);
    expect(page.totalDoseEvents).toBe(20000);
    expect(page.nextCursor?.id).toBe('dose-00099');
    const next = await repository.listHealthMedicationPage({
      ...request,
      cursor: page.nextCursor,
      includeTotals: false,
    });
    expect(next.doseEvents[0]?.id).toBe('dose-00100');
    expect(next.totalDoseEvents).toBeUndefined();
    const plan = await database.execute('EXPLAIN QUERY PLAN ' + statement, parameters);
    const details = plan.rows.map((row) => row.detail).join(' ');
    expect(details).toContain('dose_events_library_idx');
    expect(details).not.toContain('USE TEMP B-TREE');
    console.info('synthetic-medication-library-page', {
      storedRows: 20000,
      returnedRows: 100,
      queryMs,
    });
  } finally {
    close();
  }
});

test('filters medication pages by occurrence period and imported origin while preserving exact ties', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const repository = createRecordRepository(database);
    for (const [id, effectiveAt] of [
      ['a', '2026-10-20T09:00:00.0002+09:00'],
      ['b', '2026-10-20T00:00:00.0002Z'],
      ['c', '2026-10-19T00:00:00Z'],
      ['old', '2026-09-01T00:00:00Z'],
      ['future', '2026-10-22T00:00:00Z'],
    ]) {
      await repository.put('dose_event', {
        ...importedDoseEvent(id!, effectiveAt!, 'taken'),
        ingestedAt: '2026-10-23T00:00:00Z',
      });
    }
    const excluded = importedDoseEvent('other-source', '2026-10-01T00:00:00Z', 'taken');
    await repository.put('dose_event', {
      ...excluded,
      provenance: { ...excluded.provenance, source: { system: 'other' } },
    });
    const page = await repository.listHealthMedicationPage({
      fromInclusive: '2026-10-19T00:00:00Z',
      toInclusive: '2026-10-20T00:00:01Z',
      includeTotals: true,
    });
    expect(page.doseEvents.map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(page.totalDoseEvents).toBe(3);
    expect(page.nextCursor).toBeNull();
    await expect(
      repository.listHealthMedicationPage({
        fromInclusive: '2026-10-21T00:00:00Z',
        toInclusive: '2026-10-20T00:00:00Z',
      }),
    ).rejects.toThrow();
  } finally {
    close();
  }
});
