import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createConversationArtifactTool } from '../conversationArtifactTool';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

test('searches prior conversations with scoped cursors, bounded payloads and deletion-aware citations', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession(
      'private-session',
      await storage.currentGeneration(),
    );
    for (const id of ['private-a', 'private-b', 'private-c'])
      await storage.append({
        id,
        sessionId: 'private-session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: id === 'private-c' ? 'partial' : 'complete',
        question: 'question',
        answer: 'answer '.repeat(220),
        sources: [],
        citations: [],
      });
    const registry = new LocalEvidenceReferenceRegistry();
    const data = Object.assign(localData([]).data, {
      conversationArtifactDiscovery: async (
        currentRegistry: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage,
          data,
          registry: currentRegistry,
        }),
    });
    const tool = createConversationArtifactTool(data, registry, {
      scope: 'session-scope',
    });
    const request = {
      operationRunId: 'run',
      operationKey: 'search',
      input: { query: 'answer' },
      allowedScope: { sourceKinds: ['generated_artifact' as const] },
      resultLimit: 3,
      maxPayloadBytes: 2048,
      signal: new AbortController().signal,
    };
    const first = await tool.search(request);
    if ('status' in first) throw new Error('Unexpected consent result');
    expect(first.items).toHaveLength(1);
    expect(first.items[0]?.content).toContain('Historical AI-generated');
    expect(JSON.parse(first.items[0]!.content).completion).toBe('partial');
    const full = await tool.search({ ...request, maxPayloadBytes: 20000 });
    if ('status' in full) throw new Error('Unexpected consent result');
    expect(JSON.parse(full.items[0]!.content).completion).toBe('partial');
    expect(JSON.stringify(first)).not.toContain('private-');
    const token = first.coverage[0]?.nextCursor;
    expect(token).toBeDefined();
    const next = await tool.search({
      ...request,
      input: { query: 'answer', cursor: token! },
    });
    if ('status' in next) throw new Error('Unexpected consent result');
    expect(next.items).toHaveLength(1);
    expect(next.items[0]?.evidenceId).not.toBe(first.items[0]?.evidenceId);
    await expect(
      tool.search({
        ...request,
        input: { query: 'different', cursor: token! },
      }),
    ).rejects.toThrow('cursor');
    await storage.deleteSession('private-session');
    expect(
      (await registry.readSource(first.items[0]!, request.signal)).status,
    ).toBe('missing');
  } finally {
    connection.close();
  }
});

test('rechecks the whole admitted page after alias validation in a single storage snapshot', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    const generation = await storage.currentGeneration();
    for (const id of ['a', 'b']) {
      await storage.createSession(`session-${id}`, generation);
      await storage.append({
        id,
        sessionId: `session-${id}`,
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'question',
        answer: 'answer',
        sources: [],
        citations: [],
      });
    }
    const registry = new LocalEvidenceReferenceRegistry();
    const validate = registry.revalidateEvidence.bind(registry);
    jest
      .spyOn(registry, 'revalidateEvidence')
      .mockImplementation(async (items, signal) => {
        const result = await validate(items, signal);
        await storage.deleteSession('session-b');
        return result;
      });
    const data = Object.assign(localData([]).data, {
      conversationArtifactDiscovery: async (
        currentRegistry: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage,
          data,
          registry: currentRegistry,
        }),
    });
    const tool = createConversationArtifactTool(data, registry);
    await expect(
      tool.search({
        operationRunId: 'run',
        operationKey: 'search',
        input: { query: 'answer' },
        allowedScope: { sourceKinds: ['generated_artifact'] },
        resultLimit: 2,
        maxPayloadBytes: 20000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('changed during search');
  } finally {
    connection.close();
  }
});

test('does not return already admitted prose when its parent is deleted during a later source scan', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    for (const id of ['a', 'b'])
      await storage.append({
        id,
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        status: 'complete',
        question: 'question',
        answer: 'answer',
        sources: [],
        citations: [],
      });
    const registry = new LocalEvidenceReferenceRegistry();
    let calls = 0;
    const data = Object.assign(localData([]).data, {
      findIdentifiers: async () => {
        if (++calls === 2) await storage.deleteSession('session');
        return [];
      },
      conversationArtifactDiscovery: async (
        currentRegistry: LocalEvidenceReferenceRegistry,
      ) =>
        createConversationArtifactDiscovery({
          database: connection.database,
          storage,
          data,
          registry: currentRegistry,
        }),
    });
    const tool = createConversationArtifactTool(data, registry);
    await expect(
      tool.search({
        operationRunId: 'run',
        operationKey: 'search',
        input: { query: 'answer' },
        allowedScope: { sourceKinds: ['generated_artifact'] },
        resultLimit: 2,
        maxPayloadBytes: 20000,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('changed during search');
  } finally {
    connection.close();
  }
});
