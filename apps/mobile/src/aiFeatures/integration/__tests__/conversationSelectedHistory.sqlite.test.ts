import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { loadConversationHistory } from '../conversationHistorySources';
import { localData } from '../featureServiceFixtures';
import { createRagConversationService } from '../ragConversationService';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

// An unreadable older neighbor is not a selected input to the current request.
test.each([
  'valid',
  'corrupt',
  'deleted',
  'session-deleted',
  'aborted',
] as const)(
  'isolates unrelated history while preserving selected %s guards',
  async state => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(db.database);
      const storage = createConversationArtifactStorage(db.database);
      await storage.createSession('session', await storage.currentGeneration());
      for (const id of ['selected', 'unrelated']) {
        await storage.append({
          id,
          sessionId: 'session',
          createdAt: '2026-11-01T00:00:00.000Z',
          providerId: 'synthetic',
          modelId: 'synthetic',
          status: 'complete',
          question: `question ${id}`,
          answer: `answer ${id}`,
          sources: [],
          citations: [],
        });
      }
      await db.database.execute(
        'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
        ['{}', 'unrelated'],
      );
      const registry = new LocalEvidenceReferenceRegistry();
      const data = localData([]).data;
      const discovery = createConversationArtifactDiscovery({
        database: db.database,
        storage,
        registry,
        data,
      });
      Object.assign(data, {
        conversationArtifactDiscovery: async () => discovery,
      });
      expect(
        (
          await discovery.readSession({
            sessionId: 'session',
            signal: new AbortController().signal,
          })
        ).unavailableCount,
      ).toBe(1);
      if (state === 'corrupt')
        await db.database.execute(
          'UPDATE conversation_artifacts SET result_json = ? WHERE id = ?',
          ['{}', 'selected'],
        );
      if (state === 'deleted')
        await db.database.execute(
          'DELETE FROM conversation_artifacts WHERE id = ?',
          ['selected'],
        );
      if (state === 'session-deleted') await storage.deleteSession('session');
      const controller = new AbortController();
      if (state === 'aborted') controller.abort();
      const pending = loadConversationHistory({
        messages: [],
        session: { id: 'session', version: 0 },
        retainedHistory: [{ id: 'selected', question: 'question selected' }],
        data,
        registry,
        signal: controller.signal,
      });
      if (state !== 'valid') {
        await expect(pending).rejects.toThrow();
        return;
      }
      const history = await pending;
      expect(history.priorTurns).toEqual([
        {
          question: registry.redactText('question selected'),
          answer: registry.redactText('answer selected'),
        },
      ]);
      expect(history.references).toHaveLength(1);
      expect(history.omitted).toBe(false);
      // All these entry choices share the same protected history preparation.
      const fixture = publicEvidenceFixture();
      const ragRunner = jest.fn(async () => ({
        status: 'no_evidence' as const,
      }));
      const send = createRagConversationService({
        consent: fixture.consent,
        queryConsent: { authorize: async () => 'authorized' },
        externalEvidence: { search: jest.fn() },
        loadLocalData: async () => data,
        selectedAi: async () => ({
          ...fixture.selected,
          provider: {
            ...fixture.selected.provider,
            searchPublicWeb: undefined,
          },
        }),
        registry,
        ragRunner,
      });
      for (const intent of [
        'possibilities',
        'visit-questions',
        'health-summary',
        'conversation',
      ] as const) {
        await expect(
          send(
            'Continue the synthetic selected discussion.',
            [],
            undefined,
            {
              retentionSession: { id: 'session', version: 0 },
              retainedHistory: [
                { id: 'selected', question: 'question selected' },
              ],
            },
            { intent, entryKey: intent },
          ),
        ).resolves.toEqual({ status: 'no_evidence' });
      }
      expect(ragRunner).toHaveBeenCalledTimes(4);
    } finally {
      db.close();
    }
  },
);
