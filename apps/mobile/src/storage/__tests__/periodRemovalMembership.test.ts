import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { periodRemovalMembership } from '../periodRemovalMembership';
import { periodRowReferences } from '../conversationPeriodRemoval';

test.each(['source_deletion_tombstones', 'agent_memory_removed_sources'])(
  'indexed %s membership is identical for typed, linked and recording-root identities',
  async marker => {
    const f = openSqliteTestDatabase(':memory:');
    try {
      for (const sql of [
        'CREATE TABLE health_observations(id TEXT PRIMARY KEY,payload_json TEXT)',
        `CREATE TABLE ${marker}(source_id TEXT PRIMARY KEY)`,
        'CREATE TABLE typed_deletion_markers(marker_table TEXT, source_id TEXT, kind TEXT, PRIMARY KEY(marker_table,source_id,kind))',
        'CREATE TABLE transcript_segments(id TEXT PRIMARY KEY,payload_json TEXT)',
        "CREATE INDEX transcript_revision ON transcript_segments(json_extract(payload_json,'$.transcriptId'))",
      ])
        await f.database.execute(sql);
      await f.database.execute('INSERT INTO transcript_segments VALUES (?,?)', [
        'segment',
        JSON.stringify({
          transcriptId: 'transcript',
          recordingSourceId: 'root',
        }),
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
      ] as const;
      const old = `SELECT h.id FROM health_observations h WHERE EXISTS(SELECT 1 FROM ${marker} m WHERE ${periodRowReferences('m.source_id', marker, 'health_observation')})`;
      const current = `SELECT h.id FROM health_observations h WHERE ${periodRemovalMembership(marker, 'health_observation')}`;
      for (const [id, provenance, removed, kind, matches] of cases) {
        await f.database.execute('DELETE FROM health_observations');
        await f.database.execute(`DELETE FROM ${marker}`);
        await f.database.execute('DELETE FROM typed_deletion_markers');
        await f.database.execute(
          'INSERT INTO health_observations VALUES (?,?)',
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
        expect((await f.database.execute(current)).rows.length).toBe(
          matches ? 1 : 0,
        );
      }
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
