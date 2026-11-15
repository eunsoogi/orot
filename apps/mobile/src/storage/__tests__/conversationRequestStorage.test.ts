import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('completion is created atomically with a retained answer and removed with it', async () => {
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
    expect(await store.listCompletionIdentities()).toEqual([]);
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
    await store.append(answer);
    await store.append(answer);
    expect(await store.listCompletionIdentities()).toEqual([
      {
        requestId: 'request',
        sessionId: 'session',
        messageId: 'request',
        sessionVersion: 0,
        status: 'completed',
      },
    ]);
    expect(await store.read('request')).toEqual(answer);
    await connection.database.execute(
      'DELETE FROM conversation_artifacts WHERE id = ?',
      ['request'],
    );
    expect(
      (
        await connection.database.execute(
          'SELECT id FROM conversation_requests WHERE id = ?',
          ['request'],
        )
      ).rows,
    ).toEqual([]);
    expect(await store.listCompletionIdentities()).toEqual([]);
    await store.deleteSession('session');
    expect(await store.listCompletionIdentities()).toEqual([]);
  } finally {
    connection.close();
  }
});
test('recovery interrupts active requests and rejects a late answer without emitting completion', async () => {
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
    await store.interruptRecoveredRequests();
    expect((await store.listSessions()).items).toMatchObject([
      { id: 'session' },
    ]);
    expect(await store.listInterruptedRequests('session', 0)).toEqual([
      {
        id: request.id,
        interruptionReason: 'process-interrupted',
        question: request.question,
        createdAt: request.createdAt,
      },
    ]);
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
    ).rejects.toThrow('no longer active');
    await expect(
      store.append({
        id: request.id,
        sessionId: request.sessionId,
        question: request.question,
        createdAt: request.createdAt,
        providerId: 'provider',
        modelId: 'model',
        status: 'partial',
        answer: 'Late partial',
        sources: [],
      }),
    ).rejects.toThrow('no longer active');
    expect(await store.read('request')).toBeNull();
    expect(await store.listCompletionIdentities()).toEqual([]);
  } finally {
    connection.close();
  }
});

test('partial output does not produce a completion', async () => {
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
    await store.append({
      id: request.id,
      sessionId: request.sessionId,
      question: request.question,
      createdAt: request.createdAt,
      providerId: 'provider',
      modelId: 'model',
      status: 'partial',
      answer: 'Partial answer',
      sources: [],
    });
    expect(await store.listCompletionIdentities()).toEqual([]);
    expect(await store.listInterruptedRequests('session', 0)).toHaveLength(1);
    // An uncertain response after a committed partial write must be safe to retry.
    await expect(
      store.append({
        id: request.id,
        sessionId: request.sessionId,
        question: request.question,
        createdAt: request.createdAt,
        providerId: 'provider',
        modelId: 'model',
        status: 'partial',
        answer: 'Partial answer',
        sources: [],
      }),
    ).resolves.toBeUndefined();
  } finally {
    connection.close();
  }
});

test('reopening an adapter on the same connection does not interrupt live requests', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const first = createConversationArtifactStorage(connection.database);
    await first.createSession('session', await first.currentGeneration());
    await first.interruptRecoveredRequests();
    const request = {
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: 'Synthetic question',
      createdAt: '2026-11-13T00:00:00.000Z',
    };
    await first.startRequest(request);
    const second = createConversationArtifactStorage(connection.database);
    await second.interruptRecoveredRequests();
    expect(await second.listInterruptedRequests('session', 0)).toEqual([]);
    await second.append({
      id: request.id,
      sessionId: request.sessionId,
      question: request.question,
      createdAt: request.createdAt,
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      answer: 'Answer',
      sources: [],
    });
    expect(await second.listCompletionIdentities()).toHaveLength(1);
  } finally {
    connection.close();
  }
});

test('a failed answer write leaves no completion row', async () => {
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
    await connection.database.execute(
      "CREATE TRIGGER fail_answer BEFORE INSERT ON conversation_artifacts BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END",
    );
    await expect(
      store.append({
        id: request.id,
        sessionId: request.sessionId,
        question: request.question,
        createdAt: request.createdAt,
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        answer: 'Answer',
        sources: [],
      }),
    ).rejects.toThrow();
    expect(await store.read('request')).toBeNull();
    expect(await store.listCompletionIdentities()).toEqual([]);
  } finally {
    connection.close();
  }
});
