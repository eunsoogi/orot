import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  appointment,
  candidate,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';
import { createInlineVisitReview } from '../../../nextVisitQuestions/inlineVisitReview';
import { AiFeatureFlowScreen } from '../AiFeatureFlowScreen';
import { AiFeatureSharedNavigationStateProvider } from '../AiFeatureSharedNavigationState';
import { createAiFeatureServices } from '../featureServices';
import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
afterEach(() => jest.restoreAllMocks());

test('the visit entry shows editable questions in chat, saves explicitly and keeps ordinary follow-up separate', async () => {
  const services = createAiFeatureServices({ authorize: jest.fn() });
  const review = createInlineVisitReview(
    'owner-1',
    [],
    [candidate],
    [],
    () => 'candidate-1',
  );
  const prepare = jest.fn(async () => ({
    status: 'answer' as const,
    answer: '질문을 준비했어요.',
    citations: [],
    visitQuestions: { appointment, review, validateSource: async () => true },
  }));
  const send = jest.fn(async () => ({ status: 'no_evidence' as const }));
  const save = jest
    .spyOn(defaultVisitQuestionRouteOperations, 'save')
    .mockImplementation(async input => ({
      questions: input.questions.map(question => ({
        ...question,
        identity: { id: question.identity!.id, expectedRevision: 'revision-1' },
      })),
      caveats: input.caveats,
      memoryStatus: 'saved',
      validateSource: async () => true,
    }));
  await render(
    <AiFeatureSharedNavigationStateProvider>
      <AiFeatureFlowScreen
        route="visit-questions"
        navigationRouteKey="visit-entry"
        onRouteStateChange={jest.fn()}
        onBack={jest.fn()}
        onOpenDiseaseHypotheses={jest.fn()}
        onOpenRagConversation={jest.fn()}
        onOpenExternalEvidence={jest.fn()}
        onOpenProviderSelection={jest.fn()}
        onOpenSource={jest.fn()}
        resolveSelectedAi={async () => ({ status: 'selection-required' })}
        confirmConsent={jest.fn()}
        selectedAiRevision={0}
        services={{
          ...services,
          sendRagMessage: send,
          prepareVisitQuestionTurn: prepare,
        }}
        onOpenArticle={jest.fn()}
      />
    </AiFeatureSharedNavigationStateProvider>,
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '수정한 요청',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() =>
    expect(screen.getByTestId('inline-visit-review')).toBeTruthy(),
  );
  expect(save).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('inline-visit-select-0'));
  await fireEvent.changeText(
    screen.getByTestId('next-visit-question-text-0'),
    '가'.repeat(240) + '?',
  );
  await fireEvent.press(screen.getByTestId('inline-visit-save'));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        appointment,
        questions: [
          expect.objectContaining({
            questionText: '가'.repeat(240) + '?',
            identity: { id: 'candidate-1' },
          }),
        ],
      }),
    ),
  );
  await fireEvent.changeText(
    screen.getByTestId('rag-conversation-input'),
    '후속 대화',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-send'));
  await waitFor(() => expect(send).toHaveBeenCalled());
  expect(prepare).toHaveBeenCalledTimes(1);
});
