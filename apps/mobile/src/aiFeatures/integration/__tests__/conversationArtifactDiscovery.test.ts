import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { consent, localData } from '../featureServiceFixtures';
import { createAiFeatureServices } from '../featureServices';

test('pages retained conversations across sessions after reopening and reads their origin', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-conversation-catalog-'));
  const path = join(directory, 'records.sqlite');
  let connection = openSqliteTestDatabase(path);
  try {
    await runMigrations(connection.database);
    let storage = createConversationArtifactStorage(connection.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('session-a', generation);
    await storage.createSession('session-b', generation);
    for (const [id, sessionId, answer] of [
      ['a', 'session-a', '찾을 기록'],
      ['b', 'session-b', '다른 답변'],
      ['c', 'session-b', '또 다른 답변'],
    ]) {
      await storage.append({
        id: id!,
        sessionId: sessionId!,
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: '합성 질문',
        answer: answer!,
        sources: [],
        citations: [],
      });
    }
    connection.close();
    connection = openSqliteTestDatabase(path);
    storage = createConversationArtifactStorage(connection.database);
    await connection.database.execute(
      'INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES (?, ?, ?, ?)',
      ['\n'.repeat(600), 'session-b', 'broken', '{invalid'],
    );
    const data = localData([]).data;
    Object.assign(data, {
      conversationArtifactDiscovery: async (
        registry: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage,
          registry,
          data,
        }),
    });
    const services = createAiFeatureServices(consent, {
      loadLocalData: async () => data,
    });
    const discovery = await services.conversationArtifacts();
    if (!discovery) throw new Error('Missing conversation catalog.');
    const first = await discovery.search({ query: '찾을', limit: 1 });
    expect(first.items).toEqual([]);
    expect(first.unavailableCount).toBe(1);
    const original = await storage.read('c');
    if (!original) throw new Error('Missing synthetic turn.');
    const changed = { ...original, answer: 'changed after matching' };
    const raceStorage = {
      ...storage,
      read: jest
        .fn()
        .mockResolvedValueOnce(original)
        .mockResolvedValue(changed),
    };
    const racing = createConversationArtifactDiscovery({
      database: connection.database,
      storage: raceStorage,
      registry: new LocalEvidenceReferenceRegistry(),
      data,
    });
    const raced = await racing.search({
      query: original.answer,
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(raced.items).toEqual([]);
    expect(raced.unavailableCount).toBe(1);
    const second = await discovery.search({
      query: '찾을',
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items).toEqual([]);
    const third = await discovery.search({
      query: '찾을',
      limit: 1,
      cursor: second.nextCursor!,
    });
    expect(third.items).toEqual([]);
    const fourth = await discovery.search({
      query: '찾을',
      limit: 1,
      cursor: third.nextCursor!,
    });
    expect(fourth.items[0]).toMatchObject({
      id: 'a',
      type: 'conversation_turn',
      originSession: 'session-a',
      providerId: 'provider',
      modelId: 'model',
      completion: 'complete',
    });
    expect((await discovery.read('a'))?.content.answer).toBe('찾을 기록');
    await storage.deleteSession('session-a');
    expect(await discovery.read('a')).toBeNull();
  } finally {
    connection.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
