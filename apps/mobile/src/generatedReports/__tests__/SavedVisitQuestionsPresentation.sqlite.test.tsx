import { act, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { GeneratedReportDetailDestination } from '../GeneratedReportDetailDestination';
import { VisitQuestionCreateSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createRecursiveArtifactChain } from '../../storage/testSupport/generatedArtifactChain';
import { createConversationArtifactDiscovery } from '../../aiFeatures/integration/conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { fingerprint } from '../../aiFeatures/integration/evidenceUtils';
import { localData } from '../../aiFeatures/integration/featureServiceFixtures';
import {
  createGeneratedReportReader,
  openGeneratedReportReader,
} from '../readers';

jest.mock('../readers', () => ({
  ...jest.requireActual('../readers'),
  openGeneratedReportReader: jest.fn(),
}));
test('saved Visit Questions use the shared read-only question card until their source is deleted', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  const phase = AppState.currentState;
  AppState.currentState = 'active';
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
    jest.mocked(openGeneratedReportReader).mockResolvedValue(reader);
    const openCitation = jest.fn();
    const view = await render(
      <GeneratedReportDetailDestination
        active
        row={row}
        openReportSource={openCitation}
      />,
    );
    try {
      await screen.findByText('이전 대화를 확인할까요?');
      const question = screen.getByTestId('next-visit-question-0');
      expect(question).toBeVisible();
      expect(
        screen.getByTestId('next-visit-saved-question-text-0'),
      ).toHaveTextContent('이전 대화를 확인할까요?');
      expect(screen.getByText('저장된 대화의 내용을 확인해요.')).toBeVisible();
      expect(screen.queryByTestId('generated-report-paragraph-0')).toBeNull();
      expect(screen.queryByTestId('inline-visit-save')).toBeNull();
      expect(
        screen.queryByTestId('next-visit-generated-source-0-0'),
      ).toBeNull();
      expect(screen.queryByTestId('next-visit-source-0-0')).toBeNull();
      expect(openCitation).not.toHaveBeenCalled();
      await act(async () => {
        await connection.database.execute(
          "DELETE FROM conversation_artifacts WHERE id='parent-turn'",
        );
        notifyLocalSourceDeleted();
      });
      expect(
        await screen.findByText('현재 열 수 없는 자료예요.'),
      ).toBeVisible();
      expect(screen.queryByTestId('next-visit-question-0')).toBeNull();
      expect(openCitation).not.toHaveBeenCalled();
    } finally {
      await view.unmount();
    }
  } finally {
    AppState.currentState = phase;
    connection.close();
  }
});
