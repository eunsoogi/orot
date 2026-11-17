import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import {
  loadConversationHistory,
  prepareConversationHistory,
} from '../conversationHistorySources';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

// #1350: complete validated history must survive preparation and durable retention.
test('preserves all dialogue and source lineage beyond former local quotas in SQLite', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const refs = Array.from({ length: 36 }, (_, index) => ({
      sourceKind: 'external_medical' as const,
      sourceId: `source-${index}`,
      sourceRevision: '1',
      evidenceId: `evidence-${index}`,
      evidenceRevision: '1',
      locator: { kind: 'synthetic' },
      effectiveTime: null,
      reviewState: 'unknown' as const,
    }));
    const turns = Array.from({ length: 12 }, (_, index) => ({
      id: `turn-${index}`,
      revision: '1',
      question: `question-${index} ${'한😀'.repeat(1100)}`,
      answer: `answer-${index} ${'답😀'.repeat(1100)}`,
      sources: refs.slice(index * 3, index * 3 + 3),
    }));
    const revalidateSession = jest.fn(async (..._args: unknown[]) => true);
    const discovery = {
      readSession: async () => ({ items: turns, unavailableCount: 0 }),
      activeSessionVersion: async () => 0,
      revalidateSession,
    };
    const registry = new LocalEvidenceReferenceRegistry();
    const result = await loadConversationHistory({
      session: { id: 'session', version: 0 },
      retainedHistory: turns.map(({ id, question }) => ({ id, question })),
      messages: turns.flatMap(turn => [
        { role: 'user' as const, content: turn.question },
        { role: 'assistant' as const, content: 'UNVERIFIED_AI_PROSE' },
      ]),
      data: { conversationArtifactDiscovery: async () => discovery } as never,
      registry,
      signal: new AbortController().signal,
    });
    expect(revalidateSession).toHaveBeenCalledTimes(1);
    expect(revalidateSession.mock.calls[0]?.[2]).toEqual([...turns].reverse());
    expect(result.priorTurns).toEqual(
      turns.map(({ question, answer }) => ({ question, answer })),
    );
    expect(result.reports).toEqual(turns.map(turn => turn.question));
    expect(result.messages).toHaveLength(24);
    expect(JSON.stringify(result.messages)).not.toContain(
      'UNVERIFIED_AI_PROSE',
    );
    expect(result.references).toHaveLength(12);
    expect(result.sources).toHaveLength(36);
    expect(result.sources).toEqual(expect.arrayContaining(refs));
    expect(result.omitted).toBe(false);
    expect(result.excludedQuestions).toEqual([]);
    const artifact = {
      id: 'complete-history',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'follow-up',
      answer: 'clarification',
      sources: result.sources.map(reference => ({ reference, records: [] })),
      citations: [],
      priorDialogue: result.priorTurns,
      priorUserReports: result.reports,
    };
    await storage.append(artifact);
    expect(await storage.read(artifact.id)).toEqual(artifact);
  } finally {
    connection.close();
  }
});

test('explicit exclusions still remove user reports without exposing unverified assistant prose', () => {
  const history = prepareConversationHistory(
    [
      { role: 'user', content: 'excluded' },
      { role: 'assistant', content: 'UNVERIFIED_AI_PROSE' },
      { role: 'user', content: 'retained' },
    ],
    new LocalEvidenceReferenceRegistry(),
    ['excluded'],
  );
  expect(history.reports).toEqual(['retained']);
  expect(JSON.stringify(history.messages)).not.toContain('UNVERIFIED_AI_PROSE');
});
