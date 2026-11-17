import { healthContextFixture } from '../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { reference } from '../../diseaseHypotheses/taskTestSupport';
import type { ConversationArtifactSource } from '../../ragConversation/conversationArtifactSources';

/** Real SQLite preserves all admitted references and still revokes every dependency. */
test('persists more than 24 source citations and invalidates the final source on deletion', async () => {
  const f = await healthContextFixture();
  try {
    const sources: ConversationArtifactSource[] = [];
    for (let index = 0; index < 25; index++) {
      const record = { ...f.inside, id: `synthetic-${index}` };
      await f.repository.put('health_observation', record);
      sources.push({
        reference: {
          ...reference,
          sourceId: record.id,
          evidenceId: record.id,
          locator: { synthetic: 'x'.repeat(3000) },
        },
        records: [
          {
            kind: 'health_observation',
            id: record.id,
            revision: fingerprint(record),
          },
        ],
      });
    }
    const storage = createConversationArtifactStorage(f.database);
    await storage.createSession(
      'many-sources',
      await storage.currentGeneration(),
    );
    const value = {
      id: 'many-source-turn',
      sessionId: 'many-sources',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'synthetic',
      modelId: 'synthetic',
      status: 'complete' as const,
      question: 'Synthetic question',
      answer: 'Synthetic answer',
      sources,
      citations: sources.map(source => source.reference),
    };
    expect(JSON.stringify(value).length).toBeGreaterThan(128_000);
    await storage.append(value);
    // A fresh storage adapter decodes persisted JSON, rather than returning a write cache.
    expect(
      await createConversationArtifactStorage(f.database).read(value.id),
    ).toEqual(value);
    await storage.appendToolEvent({
      sessionId: value.sessionId,
      messageId: 'tool-turn',
      createdAt: value.createdAt,
      sessionVersion: 0,
      event: {
        version: 1,
        operationRunId: 'synthetic-run',
        callId: 'synthetic-call',
        toolName: 'local_search',
        order: 1,
        status: 'completed',
        inputSummary: { sourceKind: 'personal_record' },
        resultSummary: { referenceCount: 25 },
        sources: value.citations,
      },
      dependencies: sources,
    });
    expect(
      (await storage.readToolTurns(value.sessionId))[0]?.toolEvents[0]?.sources,
    ).toHaveLength(25);
    await f.repository.delete('health_observation', 'synthetic-24');
    expect(await storage.read(value.id)).toBeNull();
    await expect(storage.append(value)).rejects.toThrow();
  } finally {
    f.close();
  }
});
