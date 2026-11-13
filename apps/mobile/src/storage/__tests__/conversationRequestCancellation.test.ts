import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('cancellation erases the stored prompt and fences a late answer', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    const request = {
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: 'Synthetic question',
      createdAt: '2026-11-13T00:00:00.000Z',
    };
    await store.startRequest(request);
    await store.interruptRequest(request.id, request.sessionId, 0, 'cancelled');
    expect(
      (
        await connection.database.execute(
          'SELECT question, status FROM conversation_requests WHERE id = ?',
          [request.id],
        )
      ).rows,
    ).toEqual([{ question: '', status: 'cancelled' }]);
    await expect(
      store.append({
        id: request.id,
        sessionId: request.sessionId,
        question: request.question,
        createdAt: request.createdAt,
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        answer: 'Late answer',
        sources: [],
      }),
    ).rejects.toThrow();
    expect(await store.listCompletionIdentities()).toEqual([]);
  } finally {
    connection.close();
  }
});
