import { localQueryTimestampKey } from '@orot/storage';
import {
  indexedMarkerPeriodTables,
  markerPeriodContributorMatches,
} from '../markerPeriodContributors';
import {
  periodRemovalIndexDefinitions,
  periodRecordingIndex,
} from '../periodRemovalIndexes';
import { healthPeriodDeletionGuards } from '../healthPeriodDependencies';
import {
  fixture,
  from,
  previous,
  to,
} from '../testSupport/periodMarkerAffinityFixture';

const families = [
  ['health_observations', 'health_observation', 'measurements'],
  ['medication_definitions', 'medication_definition', 'medications'],
  ['medication_assertions', 'medication_assertion', 'medications'],
  ['dose_events', 'dose_event', 'medications'],
  ['symptom_entries', 'symptom_entry', 'symptoms'],
] as const;
test.each(families)(
  'marker-backed %s keeps direct types, recording aliases, legacy shapes and period boundaries',
  async (table, kind, topic) => {
    const f = await fixture(table);
    try {
      await f.segment('seg-a', 'root-a', 'family-a');
      await f.segment('seg-b', 'root-b', 'family-b');
      await f.segment('42', 'root-a', 75);
      await f.segment('null-root', null, null);
      for (const [id, shape] of [
        ['segment', ['seg-a']],
        ['family', ['family-a']],
        ['case-sensitive', ['SEG-A']],
        ['number-segment', [42]],
        ['string-segment', ['42']],
        ['number-family', [75]],
        ['wrong-family-affinity', ['75']],
        ['scalar', 'seg-a'],
        ['object', { unusual: 'family-a' }],
        ['multi', ['seg-b', 'family-a']],
        ['other', ['family-b']],
        ['missing', undefined],
        ['empty', []],
        ['null', null],
        ['direct', []],
      ] as const)
        await f.put(id, shape);
      await f.put('inclusive', ['seg-a'], from);
      await f.put('exclusive', ['seg-a'], to);

      for (const definition of periodRemovalIndexDefinitions(table))
        await f.database.execute(definition.sql);
      expect((await indexedMarkerPeriodTables(f.database)).has(table)).toBe(
        true,
      );
      for (const markerTable of [
        'source_deletion_tombstones',
        'agent_memory_removed_sources',
      ]) {
        const compare = async (marker: string) => {
          const guard = healthPeriodDeletionGuards()[table]!.replaceAll(
            'OLD.',
            'h.',
          );
          const request = (predicate: string) =>
            f.database.execute(
              `SELECT h.id FROM ${table} h
                CROSS JOIN (SELECT ?2 AS topic, ?3 AS from_key, ?4 AS to_key) p
                WHERE ${predicate} AND (${guard}) ORDER BY h.id`,
              [
                marker,
                topic,
                localQueryTimestampKey(from),
                localQueryTimestampKey(to),
              ],
            );
          const old = await request(previous('?1', markerTable, kind));
          const fastPredicate = markerPeriodContributorMatches(
            table,
            '?1',
            markerTable,
            kind,
            `h.id = known.id AND (${guard})`,
            true,
          );
          const now = await f.database.execute(
            `SELECT known.id FROM ${table} known
              CROSS JOIN (SELECT ?2 AS topic, ?3 AS from_key, ?4 AS to_key) p
              WHERE ${fastPredicate} ORDER BY known.id`,
            [
              marker,
              topic,
              localQueryTimestampKey(from),
              localQueryTimestampKey(to),
            ],
          );
          expect(now.rows).toEqual(old.rows);
          return now.rows.map(row => row.id);
        };
        const rootRows = await compare('root-a');
        expect(rootRows).toEqual(
          expect.arrayContaining([
            'segment',
            'family',
            'scalar',
            'object',
            'multi',
            'inclusive',
          ]),
        );
        expect(rootRows).not.toContain('wrong-family-affinity');
        expect(rootRows).not.toContain('case-sensitive');
        if (
          ['health_observations', 'dose_events', 'symptom_entries'].includes(
            table,
          )
        )
          expect(rootRows).not.toContain('exclusive');
        expect(await compare('absent-root')).toEqual([]);
        expect(await compare('ROOT-A')).toEqual([]);
        expect(await compare('direct')).toEqual(['direct']);
        await f.database.execute(
          'INSERT INTO typed_deletion_markers VALUES (?,?,?)',
          [markerTable, 'direct', 'incompatible'],
        );
        expect(await compare('direct')).toEqual([]);
        await f.database.execute(
          'INSERT INTO typed_deletion_markers VALUES (?,?,?)',
          [markerTable, 'direct', kind],
        );
        expect(await compare('direct')).toEqual(['direct']);
        const rootB = await compare('root-b');
        expect(rootB).toEqual(expect.arrayContaining(['other', 'multi']));
        const correction =
          "UPDATE transcript_segments SET payload_json=json_set(payload_json,'$.recordingSourceId',?) WHERE id=?";
        await f.database.execute(correction, ['root-b', 'seg-a']);
        expect(await compare('root-a')).not.toContain('segment');
        expect(await compare('root-b')).toContain('segment');
        await f.database.execute(correction, ['root-a', 'seg-a']);
      }
    } finally {
      f.close();
    }
  },
);

test('malformed contributor payload still fails closed in both predicates', async () => {
  const f = await fixture('health_observations');
  try {
    await f.database.execute('INSERT INTO health_observations VALUES (?,?,?)', [
      'malformed',
      '{broken-json',
      from,
    ]);
    const table = 'health_observations';
    expect((await indexedMarkerPeriodTables(f.database)).has(table)).toBe(
      false,
    );
    const original = previous(
      '?1',
      'agent_memory_removed_sources',
      'health_observation',
    );
    const retained = markerPeriodContributorMatches(
      table,
      '?1',
      'agent_memory_removed_sources',
      'health_observation',
      '1',
      false,
    );
    await expect(
      f.database.execute(`SELECT h.id FROM ${table} h WHERE ${original}`, [
        'not-a-match',
      ]),
    ).rejects.toThrow();
    await expect(
      f.database.execute(`SELECT 1 WHERE ${retained}`, ['not-a-match']),
    ).rejects.toThrow();
    for (const definition of periodRemovalIndexDefinitions(table))
      await expect(f.database.execute(definition.sql)).rejects.toThrow();
    await f.database.execute('DELETE FROM health_observations');
    for (const definition of periodRemovalIndexDefinitions(table))
      await f.database.execute(definition.sql);
    expect((await indexedMarkerPeriodTables(f.database)).has(table)).toBe(true);
    await expect(
      f.database.execute('INSERT INTO health_observations VALUES (?,?,?)', [
        'malformed',
        '{broken-json',
        from,
      ]),
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});

test('a missing alias index preserves the old failure for malformed transcript JSON', async () => {
  const f = await fixture('health_observations');
  try {
    await f.put('observable', ['unrelated']);
    for (const definition of periodRemovalIndexDefinitions(
      'health_observations',
    ))
      await f.database.execute(definition.sql);
    await f.database.execute(`DROP INDEX ${periodRecordingIndex.name}`);
    await f.database.execute('INSERT INTO transcript_segments VALUES (?,?)', [
      'malformed',
      '{broken-json',
    ]);
    expect((await indexedMarkerPeriodTables(f.database)).size).toBe(0);
    const stock = markerPeriodContributorMatches(
      'health_observations',
      '?1',
      'agent_memory_removed_sources',
      'health_observation',
      '1',
      false,
    );
    await expect(
      f.database.execute(`SELECT 1 WHERE ${stock}`, ['unmatched']),
    ).rejects.toThrow();
    await expect(
      f.database.execute(periodRecordingIndex.sql),
    ).rejects.toThrow();
    await f.database.execute('DELETE FROM transcript_segments');
    await f.database.execute(periodRecordingIndex.sql);
    expect(
      (await indexedMarkerPeriodTables(f.database)).has('health_observations'),
    ).toBe(true);
    await expect(
      f.database.execute('INSERT INTO transcript_segments VALUES (?,?)', [
        'malformed',
        '{broken-json',
      ]),
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});
