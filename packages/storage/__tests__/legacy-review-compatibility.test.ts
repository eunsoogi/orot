import { createLangGraphCheckpointStorage, openEncryptedStorage } from '../src';
import {
  createDatabase,
  join,
  mkdtempSync,
  options,
  rmSync,
  sourceRecord,
  tmpdir,
} from './sourceEvidenceTestSupport';

// Historical review requests and their linked checkpoints remain ordinary stored data after feature removal.
it('upgrades and reopens legacy review data and deletes only its source-linked checkpoints', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-legacy-review-'));
  const path = join(directory, 'records.sqlite');
  let database = createDatabase(path);
  const sourceId = 'legacy-review-request';
  const thread = `health-review:${sourceId}`;
  try {
    const repository = await openEncryptedStorage(options(database));
    await repository.transaction(async (writer) => {
      await writer.put('source_record', {
        id: sourceId,
        sourceKind: 'user_note',
        title: 'Synthetic legacy request',
        effectiveAt: '2026-01-01T00:00:00Z',
        recordedAt: '2026-01-01T00:00:00Z',
        ingestedAt: '2026-01-01T00:00:00Z',
        reviewState: { status: 'unreviewed' },
        provenance: {
          origin: 'user_reported',
          sourceRecordIds: [],
          source: { system: 'orot.health-review-request' },
        },
      });
    });
    await repository.sourceRecords.create(
      sourceRecord('retained-source', 'sha256:' + 'b'.repeat(64)),
    );
    const checkpoints = createLangGraphCheckpointStorage(database, { sourceRecordId: sourceId });
    await checkpoints.saveCheckpoint(thread, '', {
      checkpointId: 'legacy',
      parentCheckpointId: null,
      checkpointType: 'json',
      checkpoint: new Uint8Array([1, 2, 3]),
      metadataType: 'json',
      metadata: new Uint8Array(),
    });
    await checkpoints.saveWrites(thread, '', 'legacy', [
      {
        taskId: 'review',
        index: 0,
        channel: '__interrupt__',
        type: 'json',
        value: new Uint8Array([6]),
        replaceExisting: false,
      },
    ]);
    const draftThread = `health-review-draft:${sourceId}`;
    await checkpoints.saveCheckpoint(draftThread, 'app-draft', {
      checkpointId: 'draft',
      parentCheckpointId: null,
      checkpointType: 'health-review-draft-v1',
      checkpoint: new Uint8Array([4, 5]),
      metadataType: 'empty',
      metadata: new Uint8Array(),
    });
    await database.execute('PRAGMA user_version = 10');
    await database.closeAsync?.();
    database = createDatabase(path);
    const reopened = await openEncryptedStorage(options(database));
    const restored = createLangGraphCheckpointStorage(database);
    expect((await database.execute('PRAGMA user_version')).rows[0].user_version).toBe(15);
    expect(await reopened.sourceRecords.get(sourceId)).toMatchObject({ id: sourceId });
    expect((await restored.loadCheckpoint(thread, ''))?.checkpoint).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect((await restored.loadCheckpoint(thread, ''))?.pendingWrites).toHaveLength(1);
    expect((await restored.loadCheckpoint(draftThread, 'app-draft'))?.checkpoint).toEqual(
      new Uint8Array([4, 5]),
    );
    expect(await reopened.sourceRecords.delete(sourceId)).toBe(true);
    expect(await restored.loadCheckpoint(thread, '')).toBeUndefined();
    expect(await restored.loadCheckpoint(draftThread, 'app-draft')).toBeUndefined();
    for (const table of ['langgraph_checkpoint_sources', 'langgraph_checkpoint_writes']) {
      const rows = await database.execute(
        `SELECT count(*) AS count FROM ${table} WHERE thread_id IN (?, ?)`,
        [thread, draftThread],
      );
      expect(rows.rows[0].count).toBe(0);
    }
    expect(await reopened.sourceRecords.get('retained-source')).toMatchObject({
      id: 'retained-source',
    });
    await reopened.transaction(async (writer) => {
      await writer.put('source_record', {
        id: 'legacy-review-all',
        sourceKind: 'user_note',
        title: 'Legacy request',
        effectiveAt: '2026-01-01T00:00:00Z',
        recordedAt: '2026-01-01T00:00:00Z',
        ingestedAt: '2026-01-01T00:00:00Z',
        reviewState: { status: 'unreviewed' },
        provenance: {
          origin: 'user_reported',
          sourceRecordIds: [],
          source: { system: 'orot.health-review-request' },
        },
      });
    });
    const allThread = 'health-review:legacy-review-all';
    const linked = createLangGraphCheckpointStorage(database, {
      sourceRecordId: 'legacy-review-all',
    });
    await linked.saveCheckpoint(allThread, '', {
      checkpointId: 'legacy',
      parentCheckpointId: null,
      checkpointType: 'json',
      checkpoint: new Uint8Array([7]),
      metadataType: 'json',
      metadata: new Uint8Array(),
    });
    await reopened.deleteAllLocalData();
    expect(await restored.loadCheckpoint(allThread, '')).toBeUndefined();
    expect(await reopened.sourceRecords.get('legacy-review-all')).toBeNull();
    expect(await reopened.sourceRecords.get('retained-source')).toBeNull();
    const remainingLinks = await database.execute(
      'SELECT count(*) AS count FROM langgraph_checkpoint_sources WHERE thread_id = ?',
      [allThread],
    );
    expect(remainingLinks.rows[0].count).toBe(0);
  } finally {
    await database.closeAsync?.();
    rmSync(directory, { recursive: true, force: true });
  }
});
