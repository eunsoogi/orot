import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('an outbox write failure rolls back the answer and permits a safe save retry', async () => {
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
    const answer = {
      id: request.id,
      sessionId: request.sessionId,
      question: request.question,
      createdAt: request.createdAt,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      answer: 'Synthetic answer',
      sources: [],
    };
    await connection.database.execute(
      "CREATE TRIGGER fail_completion BEFORE INSERT ON conversation_completions BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    await expect(store.append(answer)).rejects.toThrow();
    expect(await store.read('request')).toBeNull();
    expect(await store.listCompletionIdentities()).toEqual([]);
    await connection.database.execute('DROP TRIGGER fail_completion');
    await store.append(answer);
    expect(await store.read('request')).toEqual(answer);
    expect(await store.listCompletionIdentities()).toHaveLength(1);
  } finally {
    connection.close();
  }
});
