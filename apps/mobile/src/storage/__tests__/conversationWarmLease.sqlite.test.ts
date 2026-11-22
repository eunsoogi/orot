import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('warm proof is read-only, leases must match the exact live pointer and generation', async () => {
  const { database, close } = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(database);
    const storage = createConversationArtifactStorage(database);
    const signal = new AbortController().signal;
    const at = '2035-01-01T00:00:00.000Z';
    const model = { providerId: 'synthetic', modelId: 'first' };
    const prior = await storage.continuousSession(
      model,
      'synthetic-one',
      at,
      signal,
    );
    await expect(storage.validateWarmLease(model, prior, signal)).resolves.toBe(
      true,
    );
    await expect(
      storage.validateWarmLease(model, { ...prior, version: 5 }, signal),
    ).resolves.toBe(false);
    const controller = new AbortController();
    controller.abort();
    await expect(
      storage.validateWarmLease(model, prior, controller.signal),
    ).resolves.toBe(false);

    const different = { ...model, modelId: 'second' };
    const current = await storage.continuousSession(
      different,
      'synthetic-two',
      at,
      signal,
    );
    await expect(storage.validateWarmLease(model, prior, signal)).resolves.toBe(
      false,
    );
    await expect(
      storage.validateWarmLease(different, current, signal),
    ).resolves.toBe(true);
    const pointer = await database.execute(
      'SELECT session_id FROM conversation_active_model',
    );
    expect(pointer.rows).toEqual([{ session_id: current.id }]);

    await storage.deleteSession(current.id);
    await expect(
      storage.validateWarmLease(different, current, signal),
    ).resolves.toBe(false);
    const counts = await database.execute(
      'SELECT count(*) AS count FROM conversation_artifact_sessions',
    );
    expect(counts.rows).toEqual([{ count: 1 }]); // no replacement or resurrection
  } finally {
    close();
  }
});
