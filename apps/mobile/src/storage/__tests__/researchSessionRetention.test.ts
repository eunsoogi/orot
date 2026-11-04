import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../conversationArtifactStorage';
import { createResearchArtifactStorage } from '../researchArtifactStorage';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';

test('session removal hides research immediately, fences late writes and permanently removes it on finalize', async () => {
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const conversations = createConversationArtifactStorage(db.database);
    await conversations.createSession(
      'session',
      await conversations.currentGeneration(),
    );
    const research = createResearchArtifactStorage(db.database);
    const generation = await research.currentGeneration();
    const source = {
      createdAt: '2026-10-05T00:00:00.000Z',
      originFeature: 'record_conversation',
      originSession: 'session',
      providerId: 'provider',
      modelId: 'model',
      source: {
        kind: 'public_web_search' as const,
        status: 'historical_snapshot' as const,
        retrievedAt: '2026-10-05T00:00:00.000Z',
        sources: [{ title: 'Synthetic source', url: 'https://example.org' }],
      },
      generatedText: 'Synthetic generated explanation',
    };
    await research.append([source], generation, undefined, {
      id: 'session',
      version: 0,
    });
    expect(await research.read(1)).not.toBeNull();
    await conversations.createSession(
      'other',
      await conversations.currentGeneration(),
    );
    const revision = fingerprint(await research.read(1));
    const reference = {
      sourceKind: 'generated_artifact' as const,
      sourceId: 'research-1',
      sourceRevision: revision,
      evidenceId: 'research-1',
      evidenceRevision: revision,
      locator: { kind: 'generated_artifact', type: 'research_web_explanation' },
      effectiveTime: null,
      reviewState: 'unknown' as const,
    };
    await conversations.append({
      id: 'dependent',
      sessionId: 'other',
      createdAt: '2026-10-05T00:00:00.000Z',
      providerId: 'provider',
      modelId: 'model',
      status: 'complete',
      question: 'question',
      answer: 'answer',
      sources: [
        { kind: 'generated_research', id: 'research-1', revision, reference },
      ],
      citations: [reference],
    });
    const version = await conversations.hideSession('session', 0);
    expect(await research.read(1)).toBeNull();
    expect(await conversations.read('dependent')).toBeNull();
    await expect(
      research.append([source], generation, undefined, {
        id: 'session',
        version: 0,
      }),
    ).rejects.toThrow();
    const restored = await conversations.undoHiddenSession('session', version!);
    expect(await research.read(1)).not.toBeNull();
    expect(await conversations.read('dependent')).not.toBeNull();
    const finalVersion = await conversations.hideSession('session', restored);
    await conversations.finalizeHiddenSession('session', finalVersion!);
    expect(
      (await db.database.execute('SELECT id FROM research_artifacts')).rows,
    ).toHaveLength(0);
    expect(await research.read(1)).toBeNull();
    expect(
      (
        await db.database.execute(
          'SELECT id FROM conversation_artifacts WHERE id = ?',
          ['dependent'],
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    db.close();
  }
});
