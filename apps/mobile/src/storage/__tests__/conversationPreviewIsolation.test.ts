import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('another conversation tool event and answer do not remove an active preview', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('a', await storage.currentGeneration());
    await storage.startRequest({
      id: 'request-a',
      sessionId: 'a',
      sessionVersion: 0,
      question: 'Question',
      createdAt: '2026-11-13T00:00:00.000Z',
    });
    const lease = { requestId: 'request-a', sessionId: 'a', sessionVersion: 0 };
    const boundary = await storage.invalidatePreview(lease);
    expect(
      await storage.preparePreview(lease, boundary, {
        providerId: 'p',
        modelId: 'm',
        sources: [],
      }),
    ).toBe(true);
    expect(await storage.writePreview(lease, boundary, 'First fragment')).toBe(
      true,
    );
    await connection.database.execute(
      'INSERT INTO conversation_tool_events VALUES (?, ?, ?, ?, ?, ?)',
      ['b', 'message-b', '2026-11-13T00:00:00.000Z', 'run-b', 'call-b', '{}'],
    );
    await connection.database.execute(
      'INSERT INTO conversation_artifacts VALUES (?, ?, ?, ?)',
      ['answer-b', 'b', '2026-11-13T00:00:00.000Z', '{}'],
    );
    expect(await storage.writePreview(lease, boundary, 'Later fragment')).toBe(
      true,
    );
    await storage.interruptRequest('request-a', 'a', 0, 'interrupted');
    expect(await storage.readInterruptedPreview(lease)).toBe('Later fragment');
    await connection.database.execute(
      'INSERT INTO conversation_artifacts VALUES (?, ?, ?, ?)',
      ['request-a', 'a', '2026-11-13T00:00:00.000Z', '{}'],
    );
    expect(await storage.readInterruptedPreview(lease)).toBeNull();
  } finally {
    connection.close();
  }
});
