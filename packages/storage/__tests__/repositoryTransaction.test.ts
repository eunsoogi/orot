import { createRecordRepository, runMigrations } from '../src';
import type { RecordWriter, SqlExecutor } from '../src';
import { openSqliteTestDatabase } from './sqliteTestDatabase';

test('shares SQL preconditions and typed writes in one transaction and rolls both back', async () => {
  const opened = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(opened.database);
    const records = createRecordRepository(opened.database);
    const operation = async (writer: RecordWriter, sql?: SqlExecutor) => {
      if (!sql) throw new Error('Atomic SQL precondition is unavailable.');
      await writer.putSyncCheckpoint({
        key: 'atomic-check',
        value: 'pending',
        updatedAt: '2026-10-01T00:00:00Z',
      });
      const result = await sql.execute(
        'SELECT value FROM healthkit_sync_checkpoints WHERE checkpoint_key = ?',
        ['atomic-check'],
      );
      expect(result.rows[0]?.value).toBe('pending');
      await sql.execute(
        'UPDATE healthkit_sync_checkpoints SET value = ? WHERE checkpoint_key = ?',
        ['guarded', 'atomic-check'],
      );
      throw new Error('Synthetic guard rejected the write.');
    };
    await expect(records.transaction(operation)).rejects.toThrow(
      'Synthetic guard rejected the write.',
    );
    expect(await records.getSyncCheckpoint('atomic-check')).toBeNull();
    await records.transaction(async (writer, sql?: SqlExecutor) => {
      if (!sql) throw new Error('Atomic SQL precondition is unavailable.');
      await writer.putSyncCheckpoint({
        key: 'atomic-check',
        value: 'saved',
        updatedAt: '2026-10-01T00:00:00Z',
      });
      expect(
        (
          await sql.execute(
            'SELECT value FROM healthkit_sync_checkpoints WHERE checkpoint_key = ?',
            ['atomic-check'],
          )
        ).rows[0]?.value,
      ).toBe('saved');
    });
    expect((await records.getSyncCheckpoint('atomic-check'))?.value).toBe('saved');
  } finally {
    opened.close();
  }
});
