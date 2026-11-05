import { fireEvent, render, screen } from '@testing-library/react-native';
import { VisitQuestionCreateSchema } from '@orot/domain';
import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createRecursiveArtifactChain } from '../../../storage/testSupport/generatedArtifactChain';
import { SavedVisitQuestionsRoute } from '../SavedVisitQuestionsRoute';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { fingerprint } from '../evidenceUtils';
import { localData } from '../featureServiceFixtures';
import { loadSavedVisitQuestionState } from '../savedVisitQuestions';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('shows a stored visit question and opens its revalidated source without generation', async () => {
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
    const appointment = {
      id: 'appointment',
      effectiveAt: '2035-06-02T09:30:00.000Z',
      recordedAt: '2026-10-07T00:00:00.000Z',
      ingestedAt: '2026-10-07T00:00:00.000Z',
      provenance: { origin: 'user_reported' as const, sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' as const },
      status: 'scheduled' as const,
      clinicLabel: '합성 진료',
    };
    const generate = jest.fn();
    const save = jest.fn();
    const onOpenSource = jest.fn();
    const view = await render(
      <SavedVisitQuestionsRoute
        onBack={jest.fn()}
        onOpenProviderSelection={jest.fn()}
        onOpenSource={onOpenSource}
        onRouteStateChange={jest.fn()}
        resolveSelectedAi={async () => ({ status: 'selection-required' })}
        confirmConsent={jest.fn()}
        resolveSource={reference => registry.resolve(reference)}
        registerVisitQuestionSource={jest.fn()}
        selectedAiRevision={0}
        loadSavedVisitQuestions={appointmentId =>
          loadSavedVisitQuestionState({
            appointmentId,
            records,
            sourceReader: data.repository,
            registry,
            data,
          })
        }
        operations={{
          loadAppointment: async () => appointment,
          generate,
          save,
        }}
      />,
    );
    expect(
      screen.getByRole('header', { name: '저장된 진료 질문' }),
    ).toHaveTextContent('저장된 진료 질문');
    expect(await screen.findByText('이전 대화를 확인할까요?')).toBeTruthy();
    expect(screen.queryByTestId('next-visit-generate')).toBeNull();
    expect(screen.queryByTestId('next-visit-saved-edit')).toBeNull();
    await fireEvent.press(
      screen.getByTestId('next-visit-generated-source-0-0'),
    );
    expect(onOpenSource).toHaveBeenCalledTimes(1);
    const reference = onOpenSource.mock.calls[0]![0];
    expect(
      (await registry.readSource(reference, new AbortController().signal))
        .status,
    ).toBe('available');
    expect(generate).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    view.unmount();
  } finally {
    connection.close();
  }
});
