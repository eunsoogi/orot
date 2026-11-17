import {
  ensurePeriodRemovalIndexes,
  periodRecordKinds,
} from '../periodRemovalIndexes';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  periodRemovalMembership,
  periodRemovalQuery,
} from '../periodRemovalMembership';
import { periodRowReferences } from '../conversationPeriodRemoval';

test.each(['source_deletion_tombstones', 'agent_memory_removed_sources'])(
  'indexed %s membership is identical for typed, linked and recording-root identities',
  async marker => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      for (const sql of [
        ...Object.keys(periodRecordKinds).map(
          table =>
            `CREATE TABLE ${table}(id TEXT PRIMARY KEY,payload_json TEXT,effective_at TEXT)`,
        ),
        `CREATE TABLE ${marker}(source_id TEXT PRIMARY KEY)`,
        'CREATE TABLE typed_deletion_markers(marker_table TEXT, source_id TEXT, kind TEXT, PRIMARY KEY(marker_table,source_id,kind))',
        'CREATE TABLE transcript_segments(id TEXT PRIMARY KEY,payload_json TEXT)',
        "CREATE INDEX transcript_revision ON transcript_segments(json_extract(payload_json,'$.transcriptId'))",
      ])
        await f.database.execute(sql);
      await ensurePeriodRemovalIndexes(f.database);
      await f.database.execute('INSERT INTO transcript_segments VALUES (?,?)', [
        'segment',
        JSON.stringify({
          transcriptId: 'transcript',
          recordingSourceId: 'root',
        }),
      ]);
      await f.database.execute('INSERT INTO transcript_segments VALUES (?,?)', [
        'numeric-transcript',
        JSON.stringify({ transcriptId: 1, recordingSourceId: 'numeric-root' }),
      ]);
      const cases = [
        ['same', {}, 'same', 'symptom_entry', false],
        ['same', {}, 'same', 'health_observation', true],
        ['same', {}, 'same', '*', true],
        ['same', {}, 'same', null, true],
        [
          'same',
          { sourceRecordIds: ['linked'] },
          'linked',
          'symptom_entry',
          true,
        ],
        [
          'same',
          { sourceRecordIds: ['segment'] },
          'root',
          'symptom_entry',
          true,
        ],
        ['same', { sourceRecordIds: ['transcript'] }, 'root', null, true],
        ['same', { sourceRecordIds: ['segment'] }, 'segment', null, true],
        ['same', { sourceRecordIds: [] }, 'unrelated', null, false],
        ['same', null, 'unrelated', null, false],
        [
          'same',
          { sourceRecordIds: ['other', 'linked'] },
          'linked',
          null,
          true,
        ],
        ['same', { sourceRecordIds: { a: 'linked' } }, 'linked', null, true],
        ['same', { sourceRecordIds: 'linked' }, 'linked', null, true],
        ['same', { sourceRecordIds: [1] }, '1', null, false],
        ['same', { sourceRecordIds: [null] }, 'unrelated', null, false],
        ['same', { sourceRecordIds: ['1'] }, 'numeric-root', null, false],
        ['same', { sourceRecordIds: [1] }, 'numeric-root', null, true],
        ['same', { sourceRecordIds: {} }, 'unrelated', null, false],
        ['same', { sourceRecordIds: null }, 'unrelated', null, false],
      ] as const;
      const old = `SELECT h.id FROM health_observations h WHERE EXISTS(SELECT 1 FROM ${marker} m WHERE ${periodRowReferences('m.source_id', marker, 'health_observation')})`;
      const current = `SELECT h.id FROM health_observations h WHERE ${periodRemovalMembership(marker, 'health_observation')}`;
      const split = periodRemovalQuery('health_observations', marker, '1', '1');
      const bindings = ['measurements', 'a', 'z'];
      for (const [id, provenance, removed, kind, matches] of cases) {
        await f.database.execute('DELETE FROM health_observations');
        await f.database.execute(`DELETE FROM ${marker}`);
        await f.database.execute('DELETE FROM typed_deletion_markers');
        await f.database.execute(
          'INSERT INTO health_observations(id,payload_json) VALUES (?,?)',
          [id, JSON.stringify({ provenance })],
        );
        expect((await f.database.execute(current)).rows).toEqual([]);
        // Marker insertion is observed by the same statement, not a separately cached empty-set precheck.
        await f.database.execute(`INSERT INTO ${marker} VALUES (?)`, [removed]);
        if (kind)
          await f.database.execute(
            'INSERT INTO typed_deletion_markers VALUES (?,?,?)',
            [marker, removed, kind],
          );
        expect((await f.database.execute(current)).rows).toEqual(
          (await f.database.execute(old)).rows,
        );
        expect((await f.database.execute(split, bindings)).rows).toEqual(
          (await f.database.execute(old)).rows,
        );
        expect((await f.database.execute(current)).rows.length).toBe(
          matches ? 1 : 0,
        );
      }
      // SQLite updates the partial-index partition when provenance changes shape.
      await f.database.execute(`DELETE FROM ${marker}`);
      await f.database.execute(`INSERT INTO ${marker} VALUES ('linked')`);
      for (const sourceRecordIds of [
        ['linked'],
        ['other', 'linked'],
        [],
        'linked',
        { a: 'linked' },
      ]) {
        await f.database.execute(
          'UPDATE health_observations SET payload_json=?',
          [JSON.stringify({ provenance: { sourceRecordIds } })],
        );
        expect((await f.database.execute(split, bindings)).rows).toEqual(
          (await f.database.execute(old)).rows,
        );
      }
      await f.database.execute('DELETE FROM health_observations');
      expect((await f.database.execute(split, bindings)).rows).toEqual([]);
      // Simulate reopening a backup made before these non-authoritative indexes.
      for (const table of Object.keys(periodRecordKinds)) {
        await f.database.execute(`DROP INDEX ${table}_period_singleton`);
        await f.database.execute(`DROP INDEX ${table}_period_fallback`);
      }
      await ensurePeriodRemovalIndexes(f.database);
      await ensurePeriodRemovalIndexes(f.database);
      expect((await f.database.execute(split, bindings)).rows).toEqual([]);
      const plan = await f.database.execute(`EXPLAIN QUERY PLAN ${current}`);
      expect(
        plan.rows.some(row => /SCAN m(?: |$)/.test(String(row.detail))),
      ).toBe(false);
      expect(
        plan.rows.some(row => /SEARCH m.*source_id=/.test(String(row.detail))),
      ).toBe(true);
    } finally {
      f.close();
    }
  },
);
