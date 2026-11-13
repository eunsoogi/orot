import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('a source mutation deletes an interrupted preview and fences a late fragment', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    await store.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: 'Synthetic question',
      createdAt: '2026-11-13T00:00:00.000Z',
    });
    const lease = {
      requestId: 'request',
      sessionId: 'session',
      sessionVersion: 0,
    };
    const boundary = await store.invalidatePreview(lease);
    expect(
      await store.preparePreview(lease, boundary, {
        providerId: 'provider',
        modelId: 'model',
        sources: [],
      }),
    ).toBe(true);
    expect(
      await store.writePreview(lease, boundary, 'Synthetic fragment'),
    ).toBe(true);
    await connection.database.execute(
      'INSERT INTO agent_memory_records (id, record_json) VALUES (?, ?)',
      ['source', '{}'],
    );
    expect(
      (
        await connection.database.execute(
          'SELECT request_id FROM conversation_request_previews',
        )
      ).rows,
    ).toEqual([]);
    expect(await store.writePreview(lease, boundary, 'Late fragment')).toBe(
      false,
    );
    expect(await store.listCompletionIdentities()).toEqual([]);
  } finally {
    connection.close();
  }
});

test('an interrupted request retains an eligible preview but cancellation deletes it', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    await store.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: 'Synthetic question',
      createdAt: '2026-11-13T00:00:00.000Z',
    });
    const lease = {
      requestId: 'request',
      sessionId: 'session',
      sessionVersion: 0,
    };
    const boundary = await store.invalidatePreview(lease);
    expect(
      await store.preparePreview(lease, boundary, {
        providerId: 'provider',
        modelId: 'model',
        sources: [],
      }),
    ).toBe(true);
    expect(
      await store.writePreview(lease, boundary, 'Synthetic fragment'),
    ).toBe(true);
    await store.interruptRequest('request', 'session', 0, 'interrupted');
    expect(
      (
        await connection.database.execute(
          'SELECT body FROM conversation_request_previews',
        )
      ).rows,
    ).toEqual([{ body: 'Synthetic fragment' }]);
    await connection.database.execute(
      "UPDATE conversation_requests SET status = 'cancelled' WHERE id = 'request'",
    );
    expect(
      (
        await connection.database.execute(
          'SELECT body FROM conversation_request_previews',
        )
      ).rows,
    ).toEqual([]);
  } finally {
    connection.close();
  }
});
