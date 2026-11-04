import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createManualHistoryRepository } from '@orot/storage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import { audioSource } from '../../../../../packages/storage/__tests__/localQueryTestSupport';

test('deleting an unrelated recording sharing a health observation ID preserves its conversation', async () => {
  const f = await healthContextFixture();
  try {
    await f.repository.put('source_record', audioSource(f.inside.id));
    const store = createConversationArtifactStorage(f.database);
    await store.createSession('collision', await store.currentGeneration());
    const direct = {
      reference: {
        ...reference,
        sourceId: f.inside.id,
        evidenceId: f.inside.id,
      },
      records: [
        {
          kind: 'health_observation' as const,
          id: f.inside.id,
          revision: fingerprint(f.inside),
        },
      ],
    };
    await store.append({
      id: 'collision-turn',
      sessionId: 'collision',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      sources: f.saved.sources,
    });
    await f.repository.sourceRecords.delete(f.inside.id);
    await store.append({
      id: 'direct-turn',
      sessionId: 'collision',
      createdAt: '2026-10-05T00:00:01.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'direct question',
      answer: 'direct answer',
      sources: [direct],
    });
    expect(
      await f.repository.get('health_observation', f.inside.id),
    ).not.toBeNull();
    expect(await store.read('collision-turn')).not.toBeNull();
    expect(await store.read('direct-turn')).not.toBeNull();
    // A later untyped marker retains the old all-kinds deletion contract.
    await f.database.execute(
      'INSERT OR IGNORE INTO source_deletion_tombstones (source_id) VALUES (?)',
      [f.inside.id],
    );
    expect(await store.read('collision-turn')).toBeNull();
    expect(await store.read('direct-turn')).toBeNull();
  } finally {
    f.close();
  }
});

test('deleting a recording still removes a conversation that depends on its observation even when IDs match', async () => {
  const f = await healthContextFixture('inside');
  try {
    const store = createConversationArtifactStorage(f.database);
    await store.createSession('linked', await store.currentGeneration());
    await store.append({
      id: 'linked-turn',
      sessionId: 'linked',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      sources: f.saved.sources,
    });
    await f.repository.sourceRecords.delete('inside');
    expect(await store.read('linked-turn')).toBeNull();
  } finally {
    f.close();
  }
});

test('saves one completed output idempotently and removes it when an input is deleted', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('session-1', generation);
    const value = {
      id: 'turn-1',
      sessionId: 'session-1',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'Synthetic question',
      answer: 'Synthetic answer',
      sources: f.saved.sources,
    };
    await storage.append(value);
    await storage.append(value);
    expect(await storage.read('turn-1')).toEqual(value);
    expect((await storage.list('session-1')).items).toHaveLength(1);
    await f.repository.delete('health_observation', f.inside.id);
    expect(await storage.read('turn-1')).toBeNull();
    await expect(storage.append(value)).rejects.toThrow();
  } finally {
    f.close();
  }
});

test.each(['source_deletion_tombstones', 'agent_memory_removed_sources'])(
  'logical removal in %s deletes output and fences a late write while the row exists',
  async table => {
    const f = await healthContextFixture();
    try {
      const history = createManualHistoryRepository(f.database);
      const source = await history.create({
        kind: 'note',
        title: 'Synthetic',
        details: 'private',
        effectiveDate: { status: 'unknown' },
      });
      const store = createConversationArtifactStorage(f.database);
      await store.createSession('session', await store.currentGeneration());
      const value = {
        id: 'turn',
        sessionId: 'session',
        createdAt: '2026-10-05T00:00:00.000Z',
        providerId: 'provider',
        modelId: 'model',
        question: 'question',
        answer: 'answer',
        status: 'partial' as const,
        sources: [
          {
            reference,
            records: [
              {
                kind: 'manual_history' as const,
                id: source.id,
                revision: fingerprint(await history.getEvidence(source.id)),
              },
            ],
          },
        ],
      };
      await store.append(value);
      expect((await store.read('turn'))?.status).toBe('partial');
      await f.database.execute(`INSERT INTO ${table} (source_id) VALUES (?)`, [
        source.id,
      ]);
      expect(await history.getEvidence(source.id)).not.toBeNull();
      expect(await store.read('turn')).toBeNull();
      await expect(store.append(value)).rejects.toThrow('removed');
    } finally {
      f.close();
    }
  },
);

test('a failed write can retry once with the same identity and rejects conflicting content', async () => {
  const f = await healthContextFixture();
  try {
    const store = createConversationArtifactStorage(f.database);
    const value = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      question: 'question',
      answer: 'answer',
      status: 'complete' as const,
      sources: f.saved.sources,
    };
    await expect(store.append(value)).rejects.toThrow();
    await store.createSession('session', await store.currentGeneration());
    await store.append(value);
    await store.append(value);
    await expect(
      store.append({ ...value, answer: 'different' }),
    ).rejects.toThrow('different output');
    expect((await store.list('session')).items).toHaveLength(1);
  } finally {
    f.close();
  }
});

test('session deletion and delete-all fence late writes and session reuse', async () => {
  const f = await healthContextFixture();
  try {
    const storage = createConversationArtifactStorage(f.database);
    const value = {
      id: 'turn-1',
      sessionId: 'session-1',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'Synthetic question',
      answer: 'Synthetic answer',
      sources: f.saved.sources,
    };
    const generation = await storage.currentGeneration();
    await storage.deleteSession('not-created');
    await expect(
      storage.createSession('not-created', generation),
    ).rejects.toThrow();
    await storage.createSession('session-1', generation);
    await storage.append(value);
    await storage.deleteSession('session-1');
    expect(await storage.read(value.id)).toBeNull();
    await expect(storage.append(value)).rejects.toThrow();
    await expect(
      storage.createSession('session-1', generation),
    ).rejects.toThrow();
    await storage.createSession('session-2', generation);
    await storage.append({ ...value, id: 'turn-2', sessionId: 'session-2' });
    await f.repository.deleteAllLocalData();
    expect(await storage.read('turn-2')).toBeNull();
    await expect(
      storage.append({ ...value, id: 'late', sessionId: 'session-2' }),
    ).rejects.toThrow();
    await expect(
      storage.createSession('session-2', await storage.currentGeneration()),
    ).rejects.toThrow();
    await expect(
      storage.createSession('late-session', generation),
    ).rejects.toThrow();
  } finally {
    f.close();
  }
});
