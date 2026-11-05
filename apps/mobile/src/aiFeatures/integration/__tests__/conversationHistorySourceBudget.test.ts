import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import {
  prepareConversationHistory,
  selectDialogueBySourceBudget,
} from '../conversationHistorySources';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';

test('reserves current evidence while storing bounded previous dialogue in SQLite', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    const refs = Array.from({ length: 32 }, (_, index) => ({
      sourceKind: 'external_medical' as const,
      sourceId: `source-${index}`,
      sourceRevision: '1',
      evidenceId: `evidence-${index}`,
      evidenceRevision: '1',
      locator: { kind: 'synthetic' },
      effectiveTime: null,
      reviewState: 'unknown' as const,
    }));
    const turns = [
      { question: 'newer', answer: 'question', sources: refs.slice(0, 16) },
      { question: 'older', answer: 'question', sources: refs.slice(16, 24) },
    ];
    const selected = selectDialogueBySourceBudget(turns, {
      resolve: ref => ref,
    });
    expect(selected.admitted.map(turn => turn.question)).toEqual(['newer']);
    expect(selected.omitted).toBe(true);
    const history = prepareConversationHistory(
      [
        { role: 'user', content: 'older' },
        { role: 'user', content: 'newer' },
      ],
      new LocalEvidenceReferenceRegistry(),
      selected.omittedTurns.map(turn => turn.question),
    );
    expect(history.reports).toEqual(['newer']);
    const sources = [
      ...selected.admitted.flatMap(turn => turn.sources),
      ...refs.slice(24, 32),
    ].map(reference => ({ reference, records: [] }));
    const artifact = {
      id: 'turn',
      sessionId: 'session',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete' as const,
      question: 'follow-up',
      answer: 'clarification',
      sources,
      citations: [],
      priorDialogue: [{ question: 'newer', answer: 'question' }],
      priorDialogueOmitted: true as const,
    };
    await storage.append(artifact);
    expect((await storage.read('turn'))?.sources).toHaveLength(24);
    expect((await storage.read('turn'))?.priorDialogueOmitted).toBe(true);
    await expect(
      storage.append({
        ...artifact,
        id: 'overflow',
        sources: [...sources, { reference: refs[16]!, records: [] }],
      }),
    ).rejects.toThrow();
  } finally {
    connection.close();
  }
});
