import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLangGraphCheckpointStorage } from '../src/checkpointStorage';
import { openSqliteTestDatabase } from './sqliteTestDatabase';

describe('LangGraph checkpoint storage', () => {
  it('upserts checkpoints and writes by their stable ids, then deletes every namespace', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-checkpoint-storage-'));
    const file = join(directory, 'checkpoints.sqlite');
    const { database, close } = openSqliteTestDatabase(file);
    try {
      const storage = createLangGraphCheckpointStorage(database);
      await storage.saveCheckpoint('workflow:visit-1', 'parent', {
        checkpointId: 'cp-1',
        parentCheckpointId: null,
        checkpointType: 'json',
        checkpoint: new Uint8Array([1]),
        metadataType: 'json',
        metadata: new Uint8Array([2]),
      });
      await storage.saveCheckpoint('workflow:visit-1', 'parent', {
        checkpointId: 'cp-1',
        parentCheckpointId: 'cp-0',
        checkpointType: 'json',
        checkpoint: new Uint8Array([3]),
        metadataType: 'json',
        metadata: new Uint8Array([4]),
      });
      await storage.saveCheckpoint('workflow:visit-1', 'child', {
        checkpointId: 'cp-2',
        parentCheckpointId: null,
        checkpointType: 'json',
        checkpoint: new Uint8Array([5]),
        metadataType: 'json',
        metadata: new Uint8Array([6]),
      });

      await storage.saveWrites('workflow:visit-1', 'parent', 'cp-1', [
        {
          taskId: 'node',
          index: 0,
          channel: 'result',
          type: 'json',
          value: new Uint8Array([7]),
          replaceExisting: false,
        },
        {
          taskId: 'node',
          index: -3,
          channel: '__interrupt__',
          type: 'json',
          value: new Uint8Array([8]),
          replaceExisting: true,
        },
      ]);
      await storage.saveWrites('workflow:visit-1', 'parent', 'cp-1', [
        {
          taskId: 'node',
          index: 0,
          channel: 'result',
          type: 'json',
          value: new Uint8Array([9]),
          replaceExisting: false,
        },
        {
          taskId: 'node',
          index: -3,
          channel: '__interrupt__',
          type: 'json',
          value: new Uint8Array([10]),
          replaceExisting: true,
        },
      ]);

      const parent = await storage.loadCheckpoint('workflow:visit-1', 'parent', 'cp-1');
      expect(parent?.checkpoint).toEqual(new Uint8Array([3]));
      expect(parent?.parentCheckpointId).toBe('cp-0');
      expect(parent?.pendingWrites.map((write) => [write.channel, [...write.value]])).toEqual([
        ['__interrupt__', [10]],
        ['result', [7]],
      ]);
      await expect(storage.loadCheckpoint('workflow:visit-1', 'child')).resolves.toMatchObject({
        checkpointId: 'cp-2',
        namespace: 'child',
      });
      const rowCount = await database.execute(
        'SELECT count(*) AS count FROM langgraph_checkpoints WHERE thread_id = ?',
        ['workflow:visit-1'],
      );
      expect(rowCount.rows[0].count).toBe(2);

      await storage.deleteThread('workflow:visit-1');
      await expect(storage.listCheckpoints('workflow:visit-1')).resolves.toEqual([]);
      const writeCount = await database.execute(
        'SELECT count(*) AS count FROM langgraph_checkpoint_writes WHERE thread_id = ?',
        ['workflow:visit-1'],
      );
      expect(writeCount.rows[0].count).toBe(0);
    } finally {
      close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rolls back all pending writes when one row fails', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'orot-checkpoint-rollback-'));
    const { database, close } = openSqliteTestDatabase(join(directory, 'checkpoints.sqlite'));
    try {
      const storage = createLangGraphCheckpointStorage(database);
      await storage.saveCheckpoint('thread', '', {
        checkpointId: 'cp-1',
        parentCheckpointId: null,
        checkpointType: 'json',
        checkpoint: new Uint8Array([1]),
        metadataType: 'json',
        metadata: new Uint8Array([2]),
      });
      await database.execute(`CREATE TRIGGER reject_second_write
        BEFORE INSERT ON langgraph_checkpoint_writes WHEN NEW.idx = 1
        BEGIN SELECT RAISE(ABORT, 'injected write failure'); END`);

      await expect(
        storage.saveWrites('thread', '', 'cp-1', [
          {
            taskId: 'node',
            index: 0,
            channel: 'first',
            type: 'json',
            value: new Uint8Array([1]),
            replaceExisting: false,
          },
          {
            taskId: 'node',
            index: 1,
            channel: 'second',
            type: 'json',
            value: new Uint8Array([2]),
            replaceExisting: false,
          },
        ]),
      ).rejects.toThrow('injected write failure');

      const checkpoint = await storage.loadCheckpoint('thread', '');
      expect(checkpoint?.pendingWrites).toEqual([]);
    } finally {
      close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
