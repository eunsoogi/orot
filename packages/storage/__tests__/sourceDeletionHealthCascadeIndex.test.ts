import { runMigrations } from '../src/migrations';
import { openEncryptedStorage } from '../src/open';
import { periodRemovalIndexDefinitions } from '../src/periodProvenanceIndexes';
import type { SqlExecutor } from '../src/sql';
import { transcriptSegment } from './localQueryTestSupport';
import { audioSourceRecord, hashB, options } from './sourceEvidenceTestSupport';
import { openSqliteTestDatabase } from './sqliteTestDatabase';

const source = '7';
const other = '70';
const timestamp = '2026-01-01T00:00:00.000Z';
const trigger = 'source_records_delete_health_observations_dependencies';

async function insert(executor: SqlExecutor, id: string, reference: unknown) {
  await executor.execute(
    'INSERT INTO health_observations (id,effective_at,recorded_at,ingested_at,payload_json) VALUES (?,?,?,?,?)',
    [
      id,
      timestamp,
      timestamp,
      timestamp,
      JSON.stringify({ provenance: { sourceRecordIds: reference } }),
    ],
  );
}

async function planUsesIndex(executor: SqlExecutor, index: string) {
  const schema = await executor.execute(
    'SELECT rootpage FROM sqlite_master WHERE type = ? AND name = ?',
    ['index', index],
  );
  expect(schema.rows).toHaveLength(1);
  const code = await executor.execute('EXPLAIN DELETE FROM source_records WHERE id = ?', [source]);
  const start = code.rows.findIndex((row) => row.p4 === '-- TRIGGER ' + trigger);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = code.rows.slice(start + 1).findIndex((row) => row.opcode === 'Init');
  const subprogram = code.rows.slice(start + 1, next < 0 ? undefined : start + 1 + next);
  const indexCursors = subprogram
    .filter((row) => row.opcode === 'OpenRead' && row.p2 === schema.rows[0]?.rootpage)
    .map((row) => row.p1);
  return subprogram.some((row) => row.opcode === 'SeekGE' && indexCursors.includes(row.p1));
}

test.each(['missing', 'mismatched', 'exact'] as const)(
  'physical health cascade preserves exact legacy matches and fences (%s index)',
  async (mode) => {
    const fixture = openSqliteTestDatabase(':memory:');
    const db = fixture.database;
    try {
      const repository = await openEncryptedStorage(options(db));
      await repository.sourceRecords.create(audioSourceRecord(source));
      await repository.sourceRecords.create({ ...audioSourceRecord(other), contentHash: hashB });
      const target = transcriptSegment(source);
      const foreign = transcriptSegment(other);
      await repository.transcripts.append([target]);
      await repository.transcripts.append([foreign]);
      const deleted = [
        'bundle',
        'direct',
        'legacy-mixed',
        'legacy-object',
        'legacy-scalar',
        'segment',
      ];
      await db.transaction(async (tx) => {
        for (const [id, reference] of [
          ['direct', [source]],
          ['bundle', [target.transcriptId]],
          ['segment', [target.id]],
          ['legacy-mixed', [other, source]],
          ['legacy-number', [7]],
          ['legacy-object', { alias: source }],
          ['legacy-scalar', source],
          ['foreign', [foreign.transcriptId]],
          ['foreign-near', [other]],
          ['none', []],
          ['legacy-null', null],
        ] as const)
          await insert(tx, id, reference);
      });
      if (mode !== 'missing') {
        // These are existing non-authoritative indexes; migration must not require or invent them.
        const definitions = periodRemovalIndexDefinitions('health_observations');
        for (const index of definitions) {
          await db.execute(
            mode === 'exact'
              ? index.sql.replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS ')
              : `CREATE INDEX ${index.name} ON health_observations (id)`,
          );
        }
        expect(await planUsesIndex(db, definitions[0]!.name)).toBe(mode === 'exact');
      }
      await runMigrations(db);
      const ids = async (
        tx: SqlExecutor,
        table: 'health_observations' | 'source_deletion_tombstones',
      ) =>
        (
          await tx.execute(
            table === 'health_observations'
              ? 'SELECT id AS id FROM health_observations ORDER BY id'
              : 'SELECT source_id AS id FROM source_deletion_tombstones ORDER BY source_id',
          )
        ).rows.map((row) => row.id);
      const before = await ids(db, 'health_observations');
      const abort = new Error('rollback physical delete');
      const survivors = ['foreign', 'foreign-near', 'legacy-null', 'legacy-number', 'none'];
      await expect(
        db.transaction(async (tx) => {
          await tx.execute('DELETE FROM source_records WHERE id = ?', [source]);
          expect(await ids(tx, 'health_observations')).toEqual(survivors);
          expect(await ids(tx, 'source_deletion_tombstones')).toEqual(
            expect.arrayContaining(deleted),
          );
          throw abort;
        }),
      ).rejects.toBe(abort);
      expect(await ids(db, 'health_observations')).toEqual(before);
      expect(await ids(db, 'source_deletion_tombstones')).toEqual([]);
      expect(await repository.sourceRecords.delete(source)).toBe(true);
      expect(await ids(db, 'health_observations')).toEqual(survivors);
      expect(await ids(db, 'source_deletion_tombstones')).toEqual(expect.arrayContaining(deleted));
    } finally {
      fixture.close();
    }
  },
);
