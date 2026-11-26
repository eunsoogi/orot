import { createDatabase } from './sourceEvidenceTestSupport';
import { stageSourceDeletionFences } from '../src/sourceDeletionFenceWrites';

test('bounded source fence batches retain wildcard and shared kinds on rollback', async () => {
  const db = createDatabase();
  try {
    await db.execute('CREATE TABLE source_deletion_tombstones (source_id TEXT PRIMARY KEY)');
    await db.execute(
      'CREATE TABLE typed_deletion_markers (marker_table TEXT, source_id TEXT, kind TEXT, PRIMARY KEY (marker_table, source_id, kind))',
    );
    await db.execute(
      'CREATE TABLE typed_deletion_write_context (marker_table TEXT, source_id TEXT, PRIMARY KEY (marker_table, source_id))',
    );
    await db.execute(
      "INSERT INTO source_deletion_tombstones VALUES ('legacy'), ('known'), ('untouched')",
    );
    await db.execute(
      "INSERT INTO typed_deletion_markers VALUES ('source_deletion_tombstones', 'known', 'source_record')",
    );
    const references = [
      { id: 'legacy', kind: 'source_record' },
      { id: 'known', kind: 'transcript_segment' },
      ...Array.from({ length: 126 }, (_, i) => ({ id: 'filler-' + i, kind: 'source_record' })),
      { id: 'legacy', kind: 'transcript_segment' },
      { id: 'known', kind: 'evidence_span' },
    ];
    const sql = {
      types:
        "SELECT source_id, kind FROM typed_deletion_markers WHERE source_id IN ('legacy', 'known') ORDER BY source_id, kind",
      tombstones: 'SELECT source_id FROM source_deletion_tombstones ORDER BY source_id',
      context: 'SELECT source_id FROM typed_deletion_write_context ORDER BY source_id',
    };
    await expect(
      db.transaction(async (tx) => {
        const clear = await stageSourceDeletionFences(tx, references);
        expect((await tx.execute(sql.types)).rows).toEqual([
          { source_id: 'known', kind: 'evidence_span' },
          { source_id: 'known', kind: 'source_record' },
          { source_id: 'known', kind: 'transcript_segment' },
          { source_id: 'legacy', kind: '*' },
          { source_id: 'legacy', kind: 'source_record' },
          { source_id: 'legacy', kind: 'transcript_segment' },
        ]);
        expect((await tx.execute(sql.tombstones)).rows).toEqual([{ source_id: 'untouched' }]);
        expect((await tx.execute(sql.context)).rows).toHaveLength(128);
        await tx.execute("INSERT INTO source_deletion_tombstones VALUES ('known'), ('legacy')");
        await clear();
        expect((await tx.execute(sql.context)).rows).toEqual([]);
        throw new Error('rollback test');
      }),
    ).rejects.toThrow('rollback test');
    expect((await db.execute(sql.tombstones)).rows).toEqual([
      { source_id: 'known' },
      { source_id: 'legacy' },
      { source_id: 'untouched' },
    ]);
    expect((await db.execute(sql.types)).rows).toEqual([
      { source_id: 'known', kind: 'source_record' },
    ]);
    expect((await db.execute(sql.context)).rows).toEqual([]);
  } finally {
    await db.closeAsync?.();
  }
});
