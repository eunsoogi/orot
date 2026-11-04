import { createRecordRepository, runMigrations } from '@orot/storage';
import { VisitQuestionCreateSchema } from '@orot/domain';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createRecursiveArtifactChain } from '../../../storage/__tests__/helpers/generatedArtifactChain';
import { fingerprint } from '../evidenceUtils';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { localData } from '../featureServiceFixtures';
import { loadSavedVisitQuestionState } from '../savedVisitQuestions';

test.each(['conversation', 'summary'] as const)(
  'restores a saved %s parent as an openable, revalidated AI source',
  async kind => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const { conversations, summaries } = await createRecursiveArtifactChain(
        connection.database,
      );
      const parent =
        kind === 'conversation'
          ? await conversations.read('parent-turn')
          : await summaries.read('child-summary');
      if (!parent) throw new Error('Missing parent');
      const id = kind === 'conversation' ? 'parent-turn' : 'child-summary';
      const records = createRecordRepository(connection.database);
      await records.put(
        'visit_question',
        VisitQuestionCreateSchema.parse({
          id: 'question',
          effectiveAt: '2026-11-01T00:00:00.000Z',
          recordedAt: '2026-10-07T00:00:00.000Z',
          ingestedAt: '2026-10-07T00:00:00.000Z',
          provenance: { origin: 'derived', sourceRecordIds: ['appointment'] },
          reviewState: {
            status: 'reviewed',
            reviewerId: 'local-user',
            reviewedAt: '2026-10-07T00:00:00.000Z',
          },
          questionText: '이전 결과를 확인할까요?',
          rationale: '이전 AI 결과를 확인해요.',
          priority: 'routine',
          evidenceSpanIds: [],
          appointmentId: 'appointment',
          position: 1,
          generatedArtifactSources: [
            {
              kind:
                kind === 'conversation'
                  ? 'generated_conversation'
                  : 'generated_summary',
              type:
                kind === 'conversation'
                  ? 'conversation_turn'
                  : 'disease_possibilities',
              id,
              revision: fingerprint(parent),
            },
          ],
        }),
      );
      const registry = new LocalEvidenceReferenceRegistry();
      const data = Object.assign(localData([]).data, {
        conversationArtifactDiscovery: async (
          r: LocalEvidenceReferenceRegistry,
        ) =>
          createConversationArtifactDiscovery({
            database: connection.database,
            storage: conversations,
            data,
            registry: r,
          }),
        summaryArtifactDiscovery: async (r: LocalEvidenceReferenceRegistry) =>
          createSummaryArtifactDiscovery({
            database: connection.database,
            storage: summaries,
            data,
            registry: r,
          }),
      });
      const load = () =>
        loadSavedVisitQuestionState({
          appointmentId: 'appointment',
          records,
          sourceReader: data.repository,
          registry,
          data,
        });
      const restored = await load();
      expect(restored.status).toBe('ready');
      if (restored.status !== 'ready')
        throw new Error('Missing saved question');
      const link = restored.questions[0]!.generatedArtifactContext![0]!;
      expect(link.sourceId).not.toBe(id);
      expect(
        (await registry.readSource(link, new AbortController().signal)).status,
      ).toBe('available');
      expect(
        await registry.revalidateEvidence([link], new AbortController().signal),
      ).toBe(true);
      const savedQuestion = await records.get('visit_question', 'question');
      if (!savedQuestion) throw new Error('Missing saved question');
      await records.put('visit_question', {
        ...savedQuestion,
        generatedArtifactSources: savedQuestion.generatedArtifactSources!.map(
          source => ({ ...source, revision: 'stale' }),
        ),
      });
      expect(await load()).toMatchObject({ status: 'error', questions: [] });
      await records.put('visit_question', savedQuestion);
      if (kind === 'summary') {
        await records.put('visit_question', {
          ...savedQuestion,
          generatedArtifactSources: savedQuestion.generatedArtifactSources!.map(
            source => ({ ...source, type: 'symptom_summary' as const }),
          ),
        });
        expect(await load()).toMatchObject({ status: 'error', questions: [] });
        await records.put('visit_question', savedQuestion);
      }
      const readQuestion = records.get.bind(records);
      const race = jest
        .spyOn(records, 'get')
        .mockImplementation(async (recordKind, recordId) => {
          if (recordKind === 'visit_question' && recordId === 'question')
            await conversations.deleteSession('parent-session');
          return readQuestion(recordKind, recordId);
        });
      expect(await load()).toMatchObject({ status: 'error', questions: [] });
      race.mockRestore();
      expect(
        await registry.revalidateEvidence([link], new AbortController().signal),
      ).toBe(false);
      const after = await load();
      expect(after).toMatchObject({ status: 'ready', questions: [] });
    } finally {
      connection.close();
    }
  },
);
