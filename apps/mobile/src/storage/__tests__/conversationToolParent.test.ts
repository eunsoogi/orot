import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createResearchArtifactStorage } from '../researchArtifactStorage';

test('removing a generated conversation parent deletes an unfinished tool result and fences a late callback', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    const generation = await storage.currentGeneration();
    await storage.createSession('parent', generation);
    await storage.createSession('child', generation);
    const parent = {
      id: 'parent-turn',
      sessionId: 'parent',
      createdAt: '2026-11-06T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'question',
      answer: 'answer',
      sources: [],
      citations: [],
    };
    await storage.append(parent);
    const revision = fingerprint(parent);
    const projected = {
      sourceKind: 'generated_artifact' as const,
      sourceId: parent.id,
      sourceRevision: revision,
      evidenceId: parent.id,
      evidenceRevision: revision,
    };
    const source = {
      kind: 'generated_conversation' as const,
      id: parent.id,
      revision,
      reference: {
        ...projected,
        locator: { kind: 'generated_artifact', type: 'conversation_turn' },
        effectiveTime: null,
        reviewState: 'unknown' as const,
      },
    };
    const input = {
      sessionId: 'child',
      messageId: 'unfinished',
      createdAt: parent.createdAt,
      sessionVersion: 0,
      event: {
        version: 1 as const,
        operationRunId: 'run',
        callId: 'call',
        toolName: 'search',
        order: 1,
        status: 'completed' as const,
        inputSummary: { sourceKind: 'generated_artifact' as const },
        resultSummary: { referenceCount: 1 },
        sources: [projected],
      },
      dependencies: [source],
    };
    await storage.appendToolEvent(input);
    await storage.deleteSession('parent');
    expect(await storage.readToolTurns('child')).toEqual([]);
    await expect(storage.appendToolEvent(input)).rejects.toThrow();
  } finally {
    connection.close();
  }
});

test('removing a generated research parent removes tool-only descendants', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const research = createResearchArtifactStorage(connection.database);
    const generation = await research.currentGeneration();
    await research.append(
      [
        {
          createdAt: '2026-11-06T00:00:00.000Z',
          originFeature: 'medical_literature',
          providerId: null,
          modelId: null,
          source: {
            kind: 'publication',
            title: 'Synthetic',
            url: 'https://europepmc.org/article/MED/123',
            status: 'historical_snapshot',
            retrievedAt: '2026-11-06T00:00:00.000Z',
          },
          generatedText: null,
        },
      ],
      generation,
    );
    const revision = fingerprint(await research.read(1));
    const projected = {
      sourceKind: 'generated_artifact' as const,
      sourceId: 'research-1',
      evidenceId: 'research-1',
      sourceRevision: revision,
      evidenceRevision: revision,
    };
    const reference = {
      ...projected,
      locator: { kind: 'generated_artifact', type: 'research_publication' },
      effectiveTime: null,
      reviewState: 'unknown' as const,
    };
    const input = {
      sessionId: 'session',
      messageId: 'unfinished',
      createdAt: '2026-11-06T00:00:00.000Z',
      sessionVersion: 0,
      event: {
        version: 1 as const,
        operationRunId: 'run',
        callId: 'call',
        toolName: 'search',
        order: 1,
        status: 'completed' as const,
        inputSummary: { sourceKind: 'generated_artifact' as const },
        sources: [projected],
      },
      dependencies: [
        {
          kind: 'generated_research' as const,
          id: 'research-1',
          revision,
          reference,
        },
      ],
    };
    await storage.appendToolEvent(input);
    await research.remove(1);
    expect(await storage.readToolTurns('session')).toEqual([]);
    await expect(storage.appendToolEvent(input)).rejects.toThrow();
  } finally {
    connection.close();
  }
});
