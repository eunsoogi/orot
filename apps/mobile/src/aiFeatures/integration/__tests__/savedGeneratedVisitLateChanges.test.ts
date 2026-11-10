import { createRecordRepository, runMigrations } from '@orot/storage';
import { VisitQuestionCreateSchema } from '@orot/domain';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createRecursiveArtifactChain } from '../../../storage/testSupport/generatedArtifactChain';
import { fingerprint } from '../evidenceUtils';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { localData } from '../featureServiceFixtures';
import { loadSavedVisitQuestionState } from '../savedVisitQuestions';

test.each(['delete', 'add', 'move', 'other-visit'] as const)(
  'rechecks the visit list after generated source validation when a %s occurs',
  async change => {
    const connection = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(connection.database);
      const { conversations } = await createRecursiveArtifactChain(
        connection.database,
      );
      const parent = await conversations.read('parent-turn');
      if (!parent) throw new Error('Missing synthetic parent');
      const records = createRecordRepository(connection.database);
      const question = VisitQuestionCreateSchema.parse({
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
            kind: 'generated_conversation',
            type: 'conversation_turn',
            id: 'parent-turn',
            revision: fingerprint(parent),
          },
        ],
      });
      await records.put('visit_question', question);
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
      });
      const revalidate = registry.revalidateEvidence.bind(registry);
      let changed = false;
      jest
        .spyOn(registry, 'revalidateEvidence')
        .mockImplementation(async (...args) => {
          const current = await revalidate(...args);
          expect(current).toBe(true);
          if (!changed) {
            changed = true;
            if (change === 'delete')
              await records.delete('visit_question', question.id);
            else if (change === 'move')
              await records.put('visit_question', {
                ...question,
                appointmentId: 'other-appointment',
              });
            else
              await records.put('visit_question', {
                ...question,
                id: 'second-question',
                appointmentId:
                  change === 'add' ? 'appointment' : 'other-appointment',
              });
          }
          return current;
        });
      const result = await loadSavedVisitQuestionState({
        appointmentId: 'appointment',
        records,
        sourceReader: data.repository,
        registry,
        data,
      });
      expect(changed).toBe(true);
      const remaining = await records.list('visit_question');
      expect(remaining.map(row => [row.id, row.appointmentId]).sort()).toEqual(
        change === 'delete'
          ? []
          : change === 'move'
            ? [['question', 'other-appointment']]
            : [
                ['question', 'appointment'],
                [
                  'second-question',
                  change === 'add' ? 'appointment' : 'other-appointment',
                ],
              ],
      );
      if (change === 'other-visit') {
        expect(result.status).toBe('ready');
      } else {
        expect(result).toMatchObject({
          status: 'error',
          questions: [],
          message: '저장된 질문 목록이 바뀌었어요. 다시 불러와 주세요.',
        });
      }
    } finally {
      connection.close();
    }
  },
);
