import { runMigrations, type SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { guardedNativeDatabase } from '../protectedReadEpoch';

/** Hold the delivered receipt only after real SQLite has returned its exact row. */
test('a prior owner retired while delivering the SQL receipt cannot escape', async () => {
  const f = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(f.database);
    let received!: () => void;
    let release!: () => void;
    const queried = new Promise<void>(resolve => {
      received = resolve;
    });
    const pending = new Promise<void>(resolve => {
      release = resolve;
    });
    const native = {
      transaction: f.database.transaction.bind(f.database),
      async execute(query, binds) {
        const result = await f.database.execute(query, binds);
        if (query.startsWith('SELECT older.id, older.version')) {
          expect(result.rows).toHaveLength(1);
          received();
          await pending;
        }
        return result;
      },
    } satisfies SqlDatabase;
    const owner = guardedNativeDatabase(native);
    const storage = createConversationArtifactStorage(
      owner,
      db => db === owner,
    );
    const signal = new AbortController().signal;
    const at = '2026-11-16T00:00:00.000Z';
    const a = await storage.continuousSession(
      { providerId: 'first', modelId: 'model' },
      'a',
      at,
      signal,
    );
    const b = await storage.continuousSession(
      { providerId: 'second', modelId: 'model' },
      'b',
      at,
      signal,
    );
    const generation = await storage.currentGeneration();
    const read = storage.readConversationDisplayPredecessor(
      { ...b, generation },
      signal,
    );
    await queried;
    try {
      await storage.hideSession(a.id, a.version);
    } finally {
      release();
    }
    expect(await read).toBeNull();
  } finally {
    f.close();
  }
});
