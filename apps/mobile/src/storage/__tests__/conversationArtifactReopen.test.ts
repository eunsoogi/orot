import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('reopen preserves completed output and an empty-corpus wipe fences late sessions and writes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-conversation-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    let storage = createConversationArtifactStorage(connection.database);
    const epoch = await storage.currentGeneration();
    await storage.createSession('session', epoch);
    await storage.deleteSession('pending');
    const value = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
      sources: [],
    };
    await storage.append(value);
    await storage.append({ ...value, id: 'turn-2' });
    const page = await storage.list('session', undefined, 1);
    expect(page.items.map(item => item.id)).toEqual(['turn-2']);
    expect(
      (await storage.list('session', page.nextCursor!, 1)).items.map(
        item => item.id,
      ),
    ).toEqual(['turn']);
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    expect(await storage.read('turn')).toEqual(value);
    await expect(storage.createSession('pending', epoch)).rejects.toThrow();
    await createRecordRepository(connection.database).deleteAllLocalData();
    expect(await storage.read('turn')).toBeNull();
    await expect(storage.append(value)).rejects.toThrow();
    await expect(storage.createSession('late', epoch)).rejects.toThrow();
    expect(await storage.currentGeneration()).toBe(epoch + 1);
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
