import { createLangGraphCheckpointStorage } from '../src/checkpointStorage';
import { openEncryptedStorage } from '../src/open';
import { openSqliteTestDatabase } from './sqliteTestDatabase';
import {
  audioSourceRecord,
  hashB,
  join,
  mkdtempSync,
  options,
  rmSync,
  tmpdir,
} from './sourceEvidenceTestSupport';

const target = 'checkpoint-index-target';
const unrelated = 'checkpoint-index-unrelated';
const sourceIndex = 'langgraph_checkpoint_sources_source_record_idx';
const approvalIndex = 'healthkit_sync_checkpoints_encounter_source_idx';

test('on reopen, owned checkpoint cleanup seeks exact owners and preserves unrelated approvals', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-checkpoint-cleanup-'));
  const file = join(directory, 'fixture.sqlite');
  let fixture = openSqliteTestDatabase(file);
  try {
    const opened = await openEncryptedStorage(options(fixture.database));
    await opened.sourceRecords.create(audioSourceRecord(target));
    await opened.sourceRecords.create({ ...audioSourceRecord(unrelated), contentHash: hashB });
    for (const id of [target, unrelated]) {
      await createLangGraphCheckpointStorage(fixture.database, {
        sourceRecordId: id,
      }).saveCheckpoint(id, '', {
        checkpointId: '1',
        parentCheckpointId: null,
        checkpointType: 'json',
        checkpoint: new Uint8Array([123, 125]),
        metadataType: 'json',
        metadata: new Uint8Array([123, 125]),
      });
    }
    await fixture.database.execute(`DROP INDEX IF EXISTS ${sourceIndex}`);
    await fixture.database.execute(`DROP INDEX IF EXISTS ${approvalIndex}`);
    for (const [key, value] of [
      ['encounter-approval:target', JSON.stringify({ sourceId: target })],
      ['encounter-approval:foreign', JSON.stringify({ sourceId: unrelated })],
      ['encounter-approval:legacy', 'not-json'],
      ['other:target', JSON.stringify({ sourceId: target })],
    ]) {
      await fixture.database.execute(
        "INSERT INTO healthkit_sync_checkpoints (checkpoint_key, value, updated_at) VALUES (?, ?, '2026-01-01')",
        [key, value],
      );
    }
    fixture.close();
    fixture = openSqliteTestDatabase(file);
    const db = fixture.database;
    const repository = await openEncryptedStorage(options(db));

    // Physical deletion calls these same indexed predicates for every fenced transcript identity.
    const sourcePlan = await db.execute(
      'EXPLAIN QUERY PLAN DELETE FROM langgraph_checkpoint_sources WHERE source_record_id = ?',
      [target],
    );
    const approvalPlan = await db.execute(
      "EXPLAIN QUERY PLAN DELETE FROM healthkit_sync_checkpoints WHERE checkpoint_key GLOB 'encounter-approval:*' AND json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END, '$.sourceId') = ?",
      [target],
    );
    expect(JSON.stringify(sourcePlan.rows)).toContain(sourceIndex);
    expect(JSON.stringify(approvalPlan.rows)).toContain(approvalIndex);

    const owned = createLangGraphCheckpointStorage(db, { sourceRecordId: target });
    const other = createLangGraphCheckpointStorage(db, { sourceRecordId: unrelated });
    const failure = new Error('synthetic cascade transaction failure');
    await expect(
      db.transaction(async (tx) => {
        await tx.execute('DELETE FROM source_records WHERE id = ?', [target]);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await owned.loadCheckpoint(target, '')).toBeDefined();
    expect(
      await db.execute(
        "SELECT checkpoint_key FROM healthkit_sync_checkpoints WHERE checkpoint_key = 'encounter-approval:target'",
      ),
    ).toMatchObject({
      rows: [{ checkpoint_key: 'encounter-approval:target' }],
    });

    expect(await repository.sourceRecords.delete(target)).toBe(true);
    expect(await owned.loadCheckpoint(target, '')).toBeUndefined();
    expect(await other.loadCheckpoint(unrelated, '')).toBeDefined();
    const stored = await db.execute(
      'SELECT thread_id FROM langgraph_checkpoints ORDER BY thread_id',
    );
    expect(stored.rows).toEqual([{ thread_id: unrelated }]);
    const approvals = await db.execute(
      'SELECT checkpoint_key FROM healthkit_sync_checkpoints ORDER BY checkpoint_key',
    );
    expect(approvals.rows.map((row) => row.checkpoint_key)).toEqual([
      'encounter-approval:foreign',
      'encounter-approval:legacy',
      'other:target',
    ]);
  } finally {
    fixture.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
