import { fireEvent, screen } from '@testing-library/react-native';
import { createRecordRepository } from '@orot/storage';
import { appointment } from '../../../agent/visitQuestions/testing/persistenceFixtures';
import { createMountedShortcutRoundTrip } from '../testSupport/mountedShortcutRoundTrip';
import { createAiFeatureServices } from '../featureServices';
import { apple, localData, selectionStore } from '../featureServiceFixtures';
import { createConversationVisitTurn } from '../conversationVisitTurn';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import { conversationExecutionNative } from '../../../ragConversation/conversationExecutionNative';
import { openSavedGeneratedReportReferences } from '../../../memory/openSavedGeneratedReportReferences';
import { t } from '../../../i18n';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../ragConversation/conversationExecutionNative');
jest.mock('../../../memory/openSavedGeneratedReportReferences');
jest.mock('../visitQuestionsRouteOperations', () => ({
  defaultVisitQuestionRouteOperations: {
    loadAppointment: jest.fn(),
    generate: jest.fn(),
    save: jest.fn(),
  },
}));

test('real Visit shortcut commits the same inline questions after reopening SQLite without regeneration', async () => {
  const questionText = '합성 확인 질문을 남길까요?';
  const rationale = '합성 복원 근거를 확인해요.';
  const generate = jest.fn().mockResolvedValue({
    ok: true,
    value: { text: 'ALLOW', toolCalls: [], finishReason: 'complete' },
  });
  generate.mockResolvedValueOnce({
    ok: true,
    value: {
      text: '질문을 함께 준비해 볼게요.',
      toolCalls: [],
      finishReason: 'complete',
    },
  });
  const provider = { ...apple.provider, generate, stream: undefined };
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const feature = await createMountedShortcutRoundTrip(async database => {
    const repository = createRecordRepository(database);
    if (!(await repository.get('appointment', appointment.id)))
      await repository.put('appointment', {
        ...appointment,
        effectiveAt: '2035-11-01T00:00:00Z',
      });
    const selectedRecord = (await repository.get(
      'appointment',
      appointment.id,
    ))!;
    const selection = { providerId: provider.id, modelId: apple.modelId };
    const data = localData([]).data;
    const dependencies = {
      selectedAi: {
        selectionStore: selectionStore(selection),
        loadAppleOption: async () => ({ ...apple, provider }),
      },
      loadLocalData: async () => ({
        ...data,
        openConversationArtifactStorage: async () =>
          createConversationArtifactStorage(database),
        repository: {
          ...data.repository,
          readRecord: repository.get.bind(repository),
        },
      }),
    };
    const services = createAiFeatureServices(consent, dependencies);
    const prepareVisitQuestionTurn = createConversationVisitTurn({
      loadLocalData: dependencies.loadLocalData,
      registry: new LocalEvidenceReferenceRegistry(),
      loadSaved: async () => ({
        status: 'ready',
        appointmentId: appointment.id,
        questions: [],
        caveats: [],
        restorationNotice: '',
      }),
      registerSource: services.registerVisitQuestionSource,
    });
    jest
      .mocked(defaultVisitQuestionRouteOperations.loadAppointment)
      .mockResolvedValue(selectedRecord);
    jest
      .mocked(openSavedGeneratedReportReferences)
      .mockResolvedValue(createConversationArtifactStorage(database));
    return {
      services: { ...services, prepareVisitQuestionTurn },
      dependencies,
      consent,
    };
  });
  jest
    .mocked(defaultVisitQuestionRouteOperations.generate)
    .mockImplementation(async input => {
      await input.beforeResearch?.();
      return {
        status: 'ready',
        questions: [
          {
            kind: 'clarification',
            questionText,
            rationale,
            priority: 'important',
            citations: [],
          },
        ],
        caveats: [],
        validateSource: async () => true,
      };
    });
  jest.mocked(conversationExecutionNative).mockReturnValue({
    bridgeAvailable: true,
    currentPhase: () => 'active',
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
    begin: async () => true,
    isActive: async () => true,
    end: () => {},
  });
  try {
    await feature.mount();
    await fireEvent.press(
      screen.getByTestId('conversation-open-visit-questions'),
    );
    const heading = t('visitQuestions.inline.title');
    expect(await screen.findByRole('header', { name: heading })).toBeVisible();
    expect(screen.getByDisplayValue(questionText)).toBeVisible();
    await fireEvent.press(screen.getByTestId('inline-visit-select-0'));

    expect(screen.getByTestId('inline-visit-save')).toBeEnabled();
    expect(
      screen.queryByTestId('conversation-bookmark-visit-questions'),
    ).toBeNull();

    expect(await feature.storage().listCompletionIdentities()).toHaveLength(1);
    const attempts = generate.mock.calls.length;
    await feature.reopen();
    expect(await screen.findByRole('header', { name: heading })).toBeVisible();
    expect(screen.getByText(questionText)).toBeVisible();
    expect(screen.getByText(rationale)).toBeVisible();
    expect(screen.queryByTestId('inline-visit-save')).toBeNull();
    expect(
      screen.queryByTestId('conversation-preview-archived-visit-questions'),
    ).toBeNull();
    expect(defaultVisitQuestionRouteOperations.generate).toHaveBeenCalledTimes(
      1,
    );
    expect(defaultVisitQuestionRouteOperations.save).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledTimes(attempts);
  } finally {
    await feature.close();
  }
});
