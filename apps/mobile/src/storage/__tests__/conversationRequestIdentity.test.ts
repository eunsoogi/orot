import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('a request cannot reuse an existing or deleted answer identity', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const store = createConversationArtifactStorage(connection.database);
    await store.createSession('session', await store.currentGeneration());
    const request = {
      id: 'answer',
      sessionId: 'session',
      sessionVersion: 0,
      question: 'Synthetic question',
      createdAt: '2026-11-13T00:00:00.000Z',
    };
    await store.append({
      id: request.id,
      sessionId: request.sessionId,
      question: request.question,
      createdAt: request.createdAt,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      answer: 'Synthetic answer',
      sources: [],
    });
    await expect(store.startRequest(request)).rejects.toThrow();
    await connection.database.execute(
      'DELETE FROM conversation_artifacts WHERE id = ?',
      [request.id],
    );
    await expect(store.startRequest(request)).rejects.toThrow();
    await store.appendToolEvent({
      sessionId: 'session',
      messageId: 'tool-only',
      createdAt: request.createdAt,
      sessionVersion: 0,
      event: {
        version: 1,
        operationRunId: 'run',
        callId: 'call',
        toolName: 'local_records',
        order: 1,
        status: 'started',
        inputSummary: { sourceKind: 'personal_record' },
        sources: [],
      },
    });
    await expect(
      store.startRequest({ ...request, id: 'tool-only' }),
    ).rejects.toThrow();
    await store.startRequest({ ...request, id: 'active-request' });
    await store.deleteSession('session');
    await store.createSession('new-session', await store.currentGeneration());
    await expect(
      store.startRequest({
        ...request,
        id: 'active-request',
        sessionId: 'new-session',
      }),
    ).rejects.toThrow();
    await expect(
      store.append({
        id: 'active-request',
        sessionId: 'new-session',
        question: request.question,
        createdAt: request.createdAt,
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        answer: 'Stale answer',
        sources: [],
      }),
    ).rejects.toThrow();
    expect(await store.listCompletionIdentities()).toEqual([]);
  } finally {
    connection.close();
  }
});
