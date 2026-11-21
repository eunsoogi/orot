import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { createVisitQuestionEvidenceAliases } from '../../../agent/visitQuestions/evidenceAliases';
import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../../../agent/visitQuestions/testing/workflowFixtures';
import { t } from '../../../i18n';
import { AiFeatureFlow } from '../AiFeatureFlow';
import { AiFeatureSharedNavigationStateProvider } from '../AiFeatureSharedNavigationState';
import { conversationIntentRequests } from '../conversationIntent';
import { createConversationVisitTurn } from '../conversationVisitTurn';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createAiFeatureServices } from '../featureServices';
import { loadVisitQuestionAppointment } from '../visitQuestionAppointment';
import { loadVisitQuestionsContext } from '../visitQuestionsContextLoader';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../visitQuestionAppointment');
jest.mock('../visitQuestionsContextLoader');

const question =
  '수면 패턴의 변화와 관련해 어떤 점을 관찰하고 기록하면 좋을까요?';
const clarification =
  '진료에서 가장 확인하고 싶은 증상이나 궁금한 점을 알려 주세요.';

test.each(['ready', 'clarification', 'stale', 'invalid'] as const)(
  'renders the %s result of the canned visit choice through its real workflow',
  async mode => {
    const context = preparedContext();
    const searchResult = await context.searchEvidence(
      '수면 기록',
      8,
      'personal_record',
    );
    const item = {
      ...context.supplementalEvidence,
      content: '최근 반복해서 잠에서 깨는 일이 늘었다고 기록했어요.',
    };
    const initial = { items: [], coverage: [], conflicts: [] };
    const toolBatch = { ...searchResult.batch, items: [item] };
    const searchEvidence = jest.fn(async () => ({
      ...searchResult,
      batch: toolBatch,
    }));
    const evidenceId =
      createVisitQuestionEvidenceAliases(initial).aliasBatch(toolBatch)
        .items[0]!.evidenceId;
    // Keep the appointment admitted. Only the selected current source can fail at presentation.
    let sourceIsCurrent = true;
    const validate = jest.fn(
      async (references: readonly unknown[]) =>
        references.length === 0 || sourceIsCurrent,
    );
    jest
      .mocked(loadVisitQuestionAppointment)
      .mockResolvedValue(context.appointment);
    jest.mocked(loadVisitQuestionsContext).mockResolvedValue({
      prepareUpcomingVisitQuestionContext: async () => ({
        ...context,
        evidence: { ...context.evidence, batch: initial },
        searchEvidence,
        revalidateEvidence: validate,
      }),
    } as never);
    const citation = mode === 'invalid' ? 'synthetic-unissued' : evidenceId;
    const final =
      mode === 'clarification'
        ? {
            type: 'result',
            value: {
              status: 'needs_clarification',
              message: '합성 방문 목표를 먼저 알려 주시겠어요?',
            },
            citations: [],
          }
        : {
            type: 'result',
            value: {
              status: 'suggestions',
              questions: [
                {
                  kind: 'confirmed_fact',
                  questionText: question,
                  rationale:
                    '최근 수면 기록의 변화를 의료진과 확인할 수 있어요.',
                  priority: 'routine',
                  evidenceIds: [citation],
                },
              ],
            },
            citations: [citation],
          };
    // The actual typed Visit recommendation runs without a real model or preview retention.
    const { provider, requests } = makeProvider(
      [
        JSON.stringify({
          text: '',
          toolCalls: [
            {
              id: 'synthetic-search',
              name: 'visit-question-personal-record-search',
              arguments: { query: '수면 기록' },
            },
          ],
          finishReason: 'tool_calls',
        }),
        JSON.stringify(final),
        JSON.stringify(final),
      ],
      (_request, call) => {
        if (mode === 'stale' && call === 1) sourceIsCurrent = false;
      },
    );
    const { selection, option } = selectedOption(provider, 'on-device');
    const consent = {
      authorize: jest.fn(),
      isAuthorizationCurrent: jest.fn(() => false),
    };
    const confirmConsent = jest.fn();
    const ready = async () => ({
      status: 'ready' as const,
      selection,
      option,
      provider,
      modelId: selection.modelId,
      recipient: 'on-device',
      remoteProcessing: false,
    });
    const loadLocalData = jest.fn();
    const prepareVisitQuestionTurn = createConversationVisitTurn({
      loadLocalData,
      registry: new LocalEvidenceReferenceRegistry(),
      loadSaved: async () => ({
        status: 'ready',
        appointmentId: context.appointment.id,
        questions: [],
        caveats: [],
        restorationNotice: '',
      }),
      registerSource: jest.fn() as never,
    });
    const sendRagMessage = jest.fn();
    const push = jest.fn();
    const prepare: typeof prepareVisitQuestionTurn = input =>
      prepareVisitQuestionTurn({ ...input, resolveSelectedAi: ready });
    await render(
      <AiFeatureSharedNavigationStateProvider>
        <AiFeatureFlow
          consent={consent}
          services={{
            ...createAiFeatureServices(consent),
            sendRagMessage,
            prepareVisitQuestionTurn: prepare,
          }}
          isEntryCurrent={() => true}
          onOpenArticle={jest.fn()}
          navigation={{
            route: { name: 'rag-conversation', key: 'root' },
            push,
            replace: jest.fn(),
            onBack: jest.fn(),
            onHome: jest.fn(),
            registerLeaveState: () => () => {},
          }}
        />
      </AiFeatureSharedNavigationStateProvider>,
    );
    await fireEvent.press(
      screen.getByTestId('conversation-open-visit-questions'),
    );
    expect(
      screen.getByText(conversationIntentRequests['visit-questions']),
    ).toBeTruthy();
    if (mode === 'ready') {
      await waitFor(() =>
        expect(screen.getByTestId('inline-visit-review')).toBeTruthy(),
      );
      expect(screen.getByDisplayValue(question)).toBeTruthy();
      expect(validate.mock.calls.some(([refs]) => refs.length > 0)).toBe(true);
    } else {
      const expected =
        mode === 'clarification'
          ? clarification
          : mode === 'stale'
            ? t('ragConversation.failureStaleEvidence')
            : t('ragConversation.failureValidation');
      await waitFor(() => expect(screen.getByText(expected)).toBeTruthy());
      expect(screen.queryByTestId('inline-visit-review')).toBeNull();
      expect(screen.queryByDisplayValue(question)).toBeNull();
      expect(loadLocalData).not.toHaveBeenCalled();
      expect(
        screen.queryByText('합성 방문 목표를 먼저 알려 주시겠어요?'),
      ).toBeNull();
    }
    expect(screen.queryByText(t('ragConversation.insufficient'))).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(sendRagMessage).not.toHaveBeenCalled();
    expect(searchEvidence).toHaveBeenCalledTimes(1);
    expect(consent.authorize).not.toHaveBeenCalled();
    expect(confirmConsent).not.toHaveBeenCalled();
    expect(
      requests.some(request =>
        JSON.stringify(request.messages).includes(
          conversationIntentRequests['visit-questions'],
        ),
      ),
    ).toBe(true);
  },
);
