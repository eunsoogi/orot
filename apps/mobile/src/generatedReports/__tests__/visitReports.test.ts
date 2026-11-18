import { VisitQuestionCreateSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createRecursiveArtifactChain } from '../../storage/testSupport/generatedArtifactChain';
import { createConversationArtifactDiscovery } from '../../aiFeatures/integration/conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import { createGeneratedReportReader } from '../readers';
test('generated question records reopen with exact source restoration, not visit recaps', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const { conversations } = await createRecursiveArtifactChain(
      connection.database,
    );
    const parent = await conversations.read('parent-turn');
    if (!parent) throw new Error('Missing stored conversation');
    const records = createRecordRepository(connection.database);
    await records.put(
      'visit_question',
      VisitQuestionCreateSchema.parse({
        id: 'question',
        effectiveAt: '2035-06-02T09:30:00.000Z',
        recordedAt: '2026-10-07T00:00:00.000Z',
        ingestedAt: '2026-10-07T00:00:00.000Z',
        provenance: { origin: 'derived', sourceRecordIds: ['appointment'] },
        reviewState: {
          status: 'reviewed',
          reviewerId: 'local-user',
          reviewedAt: '2026-10-07T00:00:00.000Z',
        },
        questionText: '이전 대화를 확인할까요?',
        rationale: '저장된 대화의 내용을 확인해요.',
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
      }),
    );
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

    const reader = createGeneratedReportReader(connection.database, {
      data: async () => data,
      records: async () => records,
    });
    const row = (await reader.list()).find(r => r.kind === 'visit_questions')!;
    expect(row.id).toBe('appointment');
    expect(
      (await reader.read(row, new AbortController().signal))?.paragraphs,
    ).toContain('이전 대화를 확인할까요?');
    await connection.database.execute(
      "DELETE FROM conversation_artifacts WHERE id='parent-turn'",
    );
    expect(await reader.read(row, new AbortController().signal)).toBeNull();
  } finally {
    connection.close();
  }
});
