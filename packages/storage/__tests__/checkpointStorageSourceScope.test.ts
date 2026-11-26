import { createLangGraphCheckpointStorage } from '../src/checkpointStorage';
import { openSqliteTestDatabase } from './sqliteTestDatabase';

const payload = {
  checkpointId: '1',
  parentCheckpointId: null,
  checkpointType: 'json',
  checkpoint: new Uint8Array([123, 125]),
  metadataType: 'json',
  metadata: new Uint8Array([123, 125]),
};

test('a scoped checkpoint reader fails closed without creating or binding schema', async () => {
  const fixture = openSqliteTestDatabase(':memory:');
  try {
    const database = fixture.database;
    const scoped = createLangGraphCheckpointStorage(database, {
      sourceRecordId: 'source-a',
    });
    expect(await scoped.loadCheckpoint('thread', '')).toBeUndefined();
    expect(await scoped.listCheckpoints('thread')).toEqual([]);
    const schema = await database.execute(
      "SELECT name FROM sqlite_master WHERE name LIKE 'langgraph_%'",
    );
    expect(schema.rows).toEqual([]);
  } finally {
    fixture.close();
  }
});

test('an exact warm checkpoint owner observes a removal marker added after schema setup', async () => {
  const fixture = openSqliteTestDatabase(':memory:');
  try {
    const database = fixture.database;
    await database.execute('CREATE TABLE source_records (id TEXT PRIMARY KEY)');
    await database.execute("INSERT INTO source_records VALUES ('source-a'), ('source-b')");
    const scoped = createLangGraphCheckpointStorage(database, {
      sourceRecordId: 'source-a',
    });
    const foreign = createLangGraphCheckpointStorage(database, {
      sourceRecordId: 'source-b',
    });
    const unscoped = createLangGraphCheckpointStorage(database);
    await scoped.saveCheckpoint('thread', '', payload);
    await scoped.saveWrites('thread', '', '1', [
      {
        taskId: 'synthetic-task',
        index: 0,
        channel: 'synthetic-channel',
        type: 'json',
        value: new Uint8Array([123, 125]),
        replaceExisting: false,
      },
    ]);
    expect(await scoped.loadCheckpoint('thread', '')).toMatchObject({
      checkpointId: '1',
      pendingWrites: [{ taskId: 'synthetic-task' }],
    });
    expect(await scoped.listCheckpoints('thread')).toHaveLength(1);
    // This canonical marker is lazily prepared after the initial integrity pass.
    await database.execute(
      'CREATE TABLE agent_memory_removed_sources (source_id TEXT PRIMARY KEY)',
    );
    await database.execute("INSERT INTO agent_memory_removed_sources VALUES ('source-a')");
    const before = await database.execute('SELECT total_changes() AS changes');
    expect(await scoped.loadCheckpoint('thread', '', '1')).toBeUndefined();
    expect(await scoped.listCheckpoints('thread')).toEqual([]);
    expect(await foreign.loadCheckpoint('thread', '')).toBeUndefined();
    expect(await foreign.listCheckpoints('thread')).toEqual([]);
    expect(await database.execute('SELECT total_changes() AS changes')).toEqual(before);
    // Deliberately verify stale bytes still exist without changing raw unscoped API behavior.
    expect(await unscoped.loadCheckpoint('thread', '')).toMatchObject({ checkpointId: '1' });
    await expect(scoped.saveCheckpoint('thread', '', payload)).rejects.toThrow(
      'Checkpoint source was removed.',
    );
  } finally {
    fixture.close();
  }
});
