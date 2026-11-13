import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('relaunch restores an unchanged incomplete preview and source mutation removes it', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-preview-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  const lease = {
    requestId: 'request',
    sessionId: 'session',
    sessionVersion: 0,
  };
  try {
    await runMigrations(connection.database);
    let storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: 'Synthetic question',
      createdAt: '2026-11-13T00:00:00.000Z',
    });
    const boundary = await storage.invalidatePreview(lease);
    expect(
      await storage.preparePreview(lease, boundary, {
        providerId: 'provider',
        modelId: 'model',
        sources: [],
      }),
    ).toBe(true);
    expect(
      await storage.writePreview(lease, boundary, 'Synthetic fragment'),
    ).toBe(true);
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    await storage.interruptRecoveredRequests();
    expect(await storage.readInterruptedPreview(lease)).toBe(
      'Synthetic fragment',
    );
    connection.close();
    connection = openSqliteTestDatabase(path);
    await connection.database.execute(
      'INSERT INTO agent_memory_records (id, record_json) VALUES (?, ?)',
      ['source', '{}'],
    );
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    await storage.interruptRecoveredRequests();
    expect(await storage.readInterruptedPreview(lease)).toBeNull();
    expect(
      (
        await connection.database.execute(
          'SELECT request_id FROM conversation_request_previews',
        )
      ).rows,
    ).toEqual([]);
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
