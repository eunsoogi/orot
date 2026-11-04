import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';

test('session pages include older retained turns, exclude hidden sessions, and restore their new version', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    const generation = await storage.currentGeneration();
    for (const id of ['a', 'b', 'c']) {
      await storage.createSession(id, generation);
      await storage.append({
        id: `turn-${id}`,
        sessionId: id,
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'private question',
        answer: 'private answer',
        sources: f.saved.sources,
        citations: [f.saved.sources[0]!.reference],
      });
    }
    await f.database.execute(
      "INSERT INTO conversation_artifacts (id, session_id, created_at, result_json) VALUES ('corrupt', 'b', 'broken', '{}')",
    );
    const first = await storage.listSessions(undefined, 2);
    expect(first.items.map(item => item.id)).toEqual(['c', 'b']);
    expect(first.nextCursor).not.toBeNull();
    expect(
      (await storage.listSessions(first.nextCursor!, 2)).items.map(
        item => item.id,
      ),
    ).toEqual(['a']);
    expect(JSON.stringify(first)).not.toContain('private');
    const undo = await storage.hideSession('b');
    expect((await storage.listSessions()).items.map(item => item.id)).toEqual([
      'c',
      'a',
    ]);
    const version = await storage.undoHiddenSession('b', undo!);
    expect(
      (await storage.listSessions()).items.find(item => item.id === 'b')
        ?.version,
    ).toBe(version);
    await f.repository.deleteAllLocalData();
    expect((await storage.listSessions()).items).toEqual([]);
  } finally {
    f.close();
  }
});
