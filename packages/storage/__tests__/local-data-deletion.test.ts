import { createLangGraphCheckpointStorage } from '../src/checkpointStorage';
import { openEncryptedStorage } from '../src/open';
import {
  createDatabase,
  hashA,
  join,
  mkdtempSync,
  options,
  rmSync,
  sourceRecord,
  tmpdir,
  audioSourceRecord,
} from './sourceEvidenceTestSupport';
import { transcriptSegment } from './localQueryTestSupport';

describe('all-local-data deletion', () => {
  it('clears records, sync state, vectors, and graph checkpoints while retaining source fences', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-all-local-delete-'));
    let database = createDatabase(join(directory, 'database.sqlite'));
    try {
      const repository = await openEncryptedStorage(options(database));
      const source = await repository.sourceRecords.create(sourceRecord('deleted-source', hashA));
      await repository.put('encounter', {
        id: 'deleted-encounter',
        effectiveAt: '2026-01-01T00:00:00Z',
        recordedAt: '2026-01-01T00:00:00Z',
        ingestedAt: '2026-01-01T00:00:00Z',
        provenance: { origin: 'derived', sourceRecordIds: [source.id] },
        reviewState: { status: 'unreviewed' },
        encounterKind: 'outpatient',
        summary: 'Synthetic encounter.',
      });
      const standaloneEncounter = {
        id: 'deleted-standalone-encounter',
        effectiveAt: '2026-01-02T00:00:00Z',
        recordedAt: '2026-01-02T00:00:00Z',
        ingestedAt: '2026-01-02T00:00:00Z',
        provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
        reviewState: { status: 'unreviewed' as const },
        encounterKind: 'outpatient' as const,
        summary: 'Synthetic standalone encounter.',
      };
      await repository.put('encounter', standaloneEncounter);
      await repository.putSyncCheckpoint({
        key: 'healthkit:last-import',
        value: 'synthetic-cursor',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      const checkpointStorage = createLangGraphCheckpointStorage(database);
      await checkpointStorage.saveCheckpoint('workflow:deleted-source', '', {
        checkpointId: 'checkpoint-1',
        parentCheckpointId: null,
        checkpointType: 'json',
        checkpoint: new Uint8Array([1]),
        metadataType: 'json',
        metadata: new Uint8Array([2]),
      });
      await checkpointStorage.saveWrites('workflow:deleted-source', '', 'checkpoint-1', [
        {
          taskId: 'synthesizer',
          index: 0,
          channel: 'result',
          type: 'json',
          value: new Uint8Array([3]),
          replaceExisting: false,
        },
      ]);
      await database.execute('CREATE TABLE deletion_vector_probe (chunk_id TEXT PRIMARY KEY)');
      await database.execute('INSERT INTO deletion_vector_probe (chunk_id) VALUES (?)', [
        'synthetic-chunk',
      ]);

      const deleted = await repository.deleteAllLocalData(async (transaction, sourceRecordIds) => {
        expect(sourceRecordIds).toEqual([source.id]);
        await transaction.execute('DELETE FROM deletion_vector_probe');
      });

      expect(deleted).toEqual({ sourceRecordIds: [source.id] });
      expect(await repository.list('source_record')).toEqual([]);
      expect(await repository.list('encounter')).toEqual([]);
      expect(await repository.getSyncCheckpoint('healthkit:last-import')).toBeNull();
      await expect(checkpointStorage.listCheckpoints('workflow:deleted-source')).resolves.toEqual(
        [],
      );
      const vectors = await database.execute('SELECT count(*) AS count FROM deletion_vector_probe');
      const tombstones = await database.execute(
        'SELECT count(*) AS count FROM source_deletion_tombstones WHERE source_id = ?',
        [source.id],
      );
      expect(vectors.rows[0]?.count).toBe(0);
      expect(tombstones.rows[0]?.count).toBe(1);
      await expect(
        repository.listDeletedSourceReferenceIds([standaloneEncounter.id]),
      ).resolves.toEqual([standaloneEncounter.id]);

      await database.closeAsync?.();
      database = createDatabase(join(directory, 'database.sqlite'));
      const reopened = await openEncryptedStorage(options(database));
      await expect(reopened.put('encounter', standaloneEncounter)).rejects.toThrow(
        'Deleted evidence cannot be reinserted.',
      );
      await expect(reopened.sourceRecords.create(sourceRecord(source.id, hashA))).rejects.toThrow(
        'A deleted source cannot be reimported.',
      );
      await expect(
        reopened.sourceRecords.create(sourceRecord('replacement-source', hashA)),
      ).resolves.toMatchObject({ id: 'replacement-source' });
    } finally {
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('restores local rows and checkpoints when source deletion fails mid-transaction', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-all-local-rollback-'));
    const database = createDatabase(join(directory, 'database.sqlite'));
    try {
      const repository = await openEncryptedStorage(options(database));
      const source = await repository.sourceRecords.create(sourceRecord('retained-source', hashA));
      await repository.put('encounter', {
        id: 'retained-encounter',
        effectiveAt: '2026-01-01T00:00:00Z',
        recordedAt: '2026-01-01T00:00:00Z',
        ingestedAt: '2026-01-01T00:00:00Z',
        provenance: { origin: 'derived', sourceRecordIds: [source.id] },
        reviewState: { status: 'unreviewed' },
        encounterKind: 'outpatient',
        summary: 'Synthetic encounter.',
      });
      await repository.putSyncCheckpoint({
        key: 'healthkit:last-import',
        value: 'synthetic-cursor',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      const checkpointStorage = createLangGraphCheckpointStorage(database);
      await checkpointStorage.saveCheckpoint('workflow:retained-source', '', {
        checkpointId: 'checkpoint-1',
        parentCheckpointId: null,
        checkpointType: 'json',
        checkpoint: new Uint8Array([1]),
        metadataType: 'json',
        metadata: new Uint8Array([2]),
      });
      await database.execute('CREATE TABLE deletion_vector_probe (chunk_id TEXT PRIMARY KEY)');
      await database.execute('INSERT INTO deletion_vector_probe (chunk_id) VALUES (?)', [
        'synthetic-chunk',
      ]);
      await database.execute(`
        CREATE TRIGGER reject_source_deletion
        BEFORE DELETE ON source_records
        BEGIN SELECT RAISE(ABORT, 'injected source deletion failure'); END
      `);

      await expect(
        repository.deleteAllLocalData(async (transaction, sourceRecordIds) => {
          expect(sourceRecordIds).toEqual([source.id]);
          await transaction.execute('DELETE FROM deletion_vector_probe');
        }),
      ).rejects.toThrow('injected source deletion failure');

      expect(await repository.sourceRecords.get(source.id)).not.toBeNull();
      expect(await repository.get('encounter', 'retained-encounter')).not.toBeNull();
      await expect(repository.getSyncCheckpoint('healthkit:last-import')).resolves.toEqual({
        key: 'healthkit:last-import',
        value: 'synthetic-cursor',
        updatedAt: '2026-01-01T00:00:00Z',
      });
      await expect(
        checkpointStorage.listCheckpoints('workflow:retained-source'),
      ).resolves.toHaveLength(1);
      const vectors = await database.execute('SELECT count(*) AS count FROM deletion_vector_probe');
      const tombstones = await database.execute(
        'SELECT count(*) AS count FROM source_deletion_tombstones WHERE source_id = ?',
        [source.id],
      );
      expect(vectors.rows[0]?.count).toBe(1);
      expect(tombstones.rows[0]?.count).toBe(0);
    } finally {
      await database.closeAsync?.();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('removes append-only transcript rows through their recording source', async () => {
    const database = createDatabase();
    try {
      const repository = await openEncryptedStorage(options(database));
      const recording = await repository.sourceRecords.create(
        audioSourceRecord('recording-with-transcript'),
      );
      const segment = transcriptSegment(recording.id);
      await repository.transcripts.append([segment]);

      // Transcript rows reject direct deletion while their recording source remains present.
      await expect(repository.deleteAllLocalData()).resolves.toEqual({
        sourceRecordIds: [recording.id],
      });

      await expect(repository.sourceRecords.get(recording.id)).resolves.toBeNull();
      await expect(repository.transcripts.listForRecording(recording.id)).resolves.toEqual([]);
      await expect(repository.list('transcript_segment')).resolves.toEqual([]);
    } finally {
      await database.closeAsync?.();
    }
  });
});
