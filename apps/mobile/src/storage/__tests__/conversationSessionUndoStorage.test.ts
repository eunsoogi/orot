import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../../aiFeatures/integration/conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';

test('hidden sessions are not discoverable and undo restores only still-valid results', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const value = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
      sources: f.saved.sources,
      citations: [f.saved.sources[0]!.reference],
    };
    await storage.append(value);
    const firstUndo = await storage.hideSession('session');
    expect(await storage.read('turn')).toBeNull();
    expect((await storage.list('session')).items).toEqual([]);
    await expect(storage.append({ ...value, id: 'late' })).rejects.toThrow();
    const discovery = createConversationArtifactDiscovery({
      database: f.database,
      storage,
      registry: new LocalEvidenceReferenceRegistry(),
      data: localData([]).data,
    });
    expect((await discovery.search({ query: '', limit: 10 })).items).toEqual(
      [],
    );
    const restoredVersion = await storage.undoHiddenSession(
      'session',
      firstUndo!,
    );
    expect(await storage.read('turn')).toEqual(value);
    await expect(
      storage.append({ ...value, id: 'old-request' }, undefined, 0),
    ).rejects.toThrow();
    await expect(storage.hideSession('session', 0)).rejects.toThrow();
    await storage.append(
      { ...value, id: 'new-request' },
      undefined,
      restoredVersion,
    );
    const secondUndo = await storage.hideSession('session', restoredVersion);
    await expect(
      storage.undoHiddenSession('session', firstUndo!),
    ).rejects.toThrow();
    await f.repository.delete('health_observation', f.inside.id);
    await storage.undoHiddenSession('session', secondUndo!);
    expect(await storage.read('turn')).toBeNull();
    expect((await storage.list('session')).items).toEqual([]);
  } finally {
    f.close();
  }
});

test('a hidden session cannot return after a clear or finalization', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('session', generation);
    const undo = await storage.hideSession('session');
    await storage.finalizeHiddenSessions();
    await expect(storage.undoHiddenSession('session', undo!)).rejects.toThrow();
    await expect(
      storage.createSession('session', generation),
    ).rejects.toThrow();
    await storage.createSession('another', generation);
    const anotherUndo = await storage.hideSession('another');
    await f.repository.deleteAllLocalData();
    await expect(
      storage.undoHiddenSession('another', anotherUndo!),
    ).rejects.toThrow();
    await storage.hideSession('not-created');
    await expect(
      storage.createSession('not-created', await storage.currentGeneration()),
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});

test('editing and reverting an input while hidden cannot restore its old derived output', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession('session', await storage.currentGeneration());
    const value = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
      sources: f.saved.sources,
      citations: [f.saved.sources[0]!.reference],
    };
    await storage.append(value);
    const undo = await storage.hideSession('session');
    await f.repository.put('health_observation', {
      ...f.inside,
      value: { kind: 'quantity', amount: 99, unit: 'count/min' },
    });
    await f.repository.put('health_observation', f.inside);
    await storage.undoHiddenSession('session', undo!);
    expect(await storage.read('turn')).toBeNull();
    expect((await storage.list('session')).items).toEqual([]);
  } finally {
    f.close();
  }
});
