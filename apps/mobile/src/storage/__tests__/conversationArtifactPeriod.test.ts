import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { decodeConversationArtifact } from '../conversationArtifactCodec';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';

test('logical removal of a period contributor fences retained and late results', async () => {
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
    };
    await storage.append(value);
    await f.repository.put(
      'health_observation',
      healthObservation('outside', 'heart_rate', '2026-09-01T00:00:00Z'),
    );
    await f.database.execute(
      'INSERT INTO source_deletion_tombstones (source_id) VALUES (?)',
      ['outside'],
    );
    expect(await storage.read('turn')).not.toBeNull();
    await f.database.execute(
      'INSERT INTO source_deletion_tombstones (source_id) VALUES (?)',
      ['unrelated-identity'],
    );
    expect(await storage.read('turn')).not.toBeNull();
    await f.database.execute(
      'INSERT INTO source_deletion_tombstones (source_id) VALUES (?)',
      [f.inside.id],
    );
    expect(
      await f.repository.get('health_observation', f.inside.id),
    ).not.toBeNull();
    expect(await storage.read('turn')).toBeNull();
    await expect(storage.append(value)).rejects.toThrow();
  } finally {
    f.close();
  }
});

test('an existing logical removal fences a period even when its source row remains', async () => {
  const f = await healthContextFixture();
  try {
    await f.database.execute(
      'INSERT INTO source_deletion_tombstones (source_id) VALUES (?)',
      [f.inside.id],
    );
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
    };
    await expect(storage.append(value)).rejects.toThrow(
      'period source was removed',
    );
  } finally {
    f.close();
  }
});

test('a transcript correction cannot resurrect a result through a same-value replacement', async () => {
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
    };
    await storage.append(value);
    await f.database.execute(
      'INSERT INTO transcript_artifact_staleness (transcript_id, artifact_kind, artifact_id, superseded_segment_id, current_segment_id, invalidated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        'transcript',
        'health_observation',
        f.inside.id,
        'old',
        'new',
        '2026-10-05T00:00:00Z',
      ],
    );
    await f.repository.put('health_observation', {
      ...f.inside,
      id: 'replacement',
    });
    expect(await storage.read('turn')).toBeNull();
    expect((await storage.list('session')).items).toEqual([]);
  } finally {
    f.close();
  }
});

test('rejects valid JSON with invalid typed output and source metadata', async () => {
  const f = await healthContextFixture();
  try {
    const value = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      sources: f.saved.sources,
    };
    expect(
      decodeConversationArtifact(
        JSON.stringify({ ...value, status: ['partial'] }),
      ),
    ).toBeNull();
    expect(
      decodeConversationArtifact(
        JSON.stringify({ ...value, createdAt: '2026-10-05T09:00:00+09:00' }),
      ),
    ).toBeNull();
    const source = value.sources[0]!;
    expect(
      decodeConversationArtifact(
        JSON.stringify({ ...value, citations: [source.reference] }),
      ),
    ).not.toBeNull();
    expect(
      decodeConversationArtifact(
        JSON.stringify({
          ...value,
          citations: [{ ...source.reference, evidenceId: 'different' }],
        }),
      ),
    ).toBeNull();
    expect(
      decodeConversationArtifact(
        JSON.stringify({
          ...value,
          sources: [
            {
              ...source,
              reference: {
                ...source.reference,
                sourceKind: ['personal_record'],
              },
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      decodeConversationArtifact(
        JSON.stringify({
          ...value,
          sources: [
            {
              ...source,
              reference: { ...source.reference, effectiveTime: 42 },
            },
          ],
        }),
      ),
    ).toBeNull();
  } finally {
    f.close();
  }
});
