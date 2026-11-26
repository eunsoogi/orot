import { gate, visitServices } from '../testSupport/appleVisitOpeningFixture';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import {
  AppleFoundationModelsProvider,
  type AppleFoundationModelsNativeBridge,
} from '@orot/provider-apple';
import { createVisitQuestionEvidenceAliases } from '../../../agent/visitQuestions/evidenceAliases';
import { modelResponseFixture } from '../../../agent/visitQuestions/testing/modelResponseFixture';
import {
  preparedContext,
  selectedOption,
} from '../../../agent/visitQuestions/testing/workflowFixtures';
import { t } from '../../../i18n';
import { serializeAppleRequest } from '../../../providers/apple/serializeRequest';
import { AiFeatureFlow } from '../AiFeatureFlow';
import { AiFeatureSharedNavigationStateProvider } from '../AiFeatureSharedNavigationState';
import { createConversationVisitTurn } from '../conversationVisitTurn';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createAiFeatureServices } from '../featureServices';
import { installReceiptFixturePlatform } from '../testSupport/conversationReceiptFixturePlatform';
import { loadVisitQuestionAppointment } from '../visitQuestionAppointment';
import { loadVisitQuestionsContext } from '../visitQuestionsContextLoader';
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../visitQuestionAppointment');
jest.mock('../visitQuestionsContextLoader');
const opening = '다음 진료에서 꺼낼 이야기를 살펴볼게요.';
const openingId = 'conversation-assistant-opening-message';
const question =
  '수면 패턴의 변화와 관련해 어떤 점을 관찰하고 기록하면 좋을까요?';
test.each(['ready', 'assets-lost', 'unsupported'] as const)(
  'Visit Questions shows its reviewed Apple opening before its actual main workflow: %s',
  async outcome => {
    const review = gate();
    const main = gate();
    const marks: string[] = [];
    const restore = installReceiptFixturePlatform(mark => marks.push(mark));
    // Verify mounted visibility without pretending this host runs native-driver animation.
    jest
      .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
      .mockResolvedValue(true);
    const context = preparedContext();
    const initial = { items: [], coverage: [], conflicts: [] };
    const supplemental = await context.searchEvidence(
      '수면 기록',
      8,
      'personal_record',
    );
    const evidence = {
      ...context.supplementalEvidence,
      content: '최근 반복해서 잠에서 깨는 일이 늘었다고 기록했어요.',
    };
    const batch = { ...supplemental.batch, items: [evidence] };
    const evidenceId =
      createVisitQuestionEvidenceAliases(initial).aliasBatch(batch).items[0]!
        .evidenceId;
    const searchEvidence = jest.fn(async () => ({ ...supplemental, batch }));
    const revalidate = jest.fn(async () => true);
    jest
      .mocked(loadVisitQuestionAppointment)
      .mockResolvedValue(context.appointment);
    jest.mocked(loadVisitQuestionsContext).mockResolvedValue({
      prepareUpcomingVisitQuestionContext: async () => ({
        ...context,
        evidence: { ...context.evidence, batch: initial },
        searchEvidence,
        revalidateEvidence: revalidate,
      }),
    } as never);
    const finalized = JSON.stringify({
      type: 'result',
      value: {
        status: 'suggestions',
        questions: [
          {
            kind: 'confirmed_fact',
            questionText: question,
            rationale: '최근 수면 기록의 변화를 의료진과 확인할 수 있어요.',
            priority: 'routine',
            evidenceIds: [evidenceId],
          },
        ],
      },
      citations: [evidenceId],
    });
    // Replace the native transport, not the Visit workflow or response validation.
    const stream = jest.fn<
      ReturnType<AppleFoundationModelsNativeBridge['stream']>,
      Parameters<AppleFoundationModelsNativeBridge['stream']>
    >(async function* (request) {
      serializeAppleRequest(request);
      const phase = stream.mock.calls.length;
      if (phase === 1) {
        yield { type: 'snapshot', text: opening };
        yield { type: 'completed', response: modelResponseFixture(opening) };
      } else if (phase === 2) {
        await review.wait;
        yield { type: 'completed', response: modelResponseFixture('ALLOW') };
      } else if (phase === 3) {
        await main.wait;
        if (outcome === 'unsupported') {
          yield {
            type: 'error',
            code: 'UNSUPPORTED_CAPABILITY',
            message: 'Synthetic Apple failure.',
          };
          return;
        }
        yield {
          type: 'completed',
          response: {
            text: '',
            toolCalls: [
              {
                id: 'synthetic-visit-search',
                name: 'visit-question-personal-record-search',
                arguments: { query: '수면 기록' },
              },
            ],
            finishReason: 'tool_calls',
          },
        };
      } else if (phase === 4) {
        yield outcome === 'assets-lost'
          ? {
              type: 'error',
              code: 'APPLE_MODEL_UNAVAILABLE',
              status: 'unavailable',
              message: 'Synthetic private Apple detail.',
            }
          : { type: 'completed', response: modelResponseFixture(finalized) };
      } else {
        throw new Error('Unexpected additional Apple Visit request');
      }
    });
    const generate = jest.fn(async () => {
      throw new Error('Unexpected non-streaming Apple Visit request');
    });
    const provider = new AppleFoundationModelsProvider({
      getAvailability: async () => ({ status: 'available' }),
      generate,
      stream,
      cancel: jest.fn(),
    });
    const { selection, option } = selectedOption(provider, 'on-device');
    const consent = {
      authorize: jest.fn(async () => 'renewal_required' as const),
    };
    const sendRagMessage = jest.fn();
    const prepare = createConversationVisitTurn({
      loadLocalData: jest.fn(),
      generatedArtifactTools: visitServices(consent).generatedArtifactTools,
      registry: new LocalEvidenceReferenceRegistry(),
      loadSaved: async () => ({
        status: 'ready',
        appointmentId: context.appointment.id,
        questions: [],
        caveats: [],
        restorationNotice: '',
      }),
      registerSource: jest.fn(),
    });
    const view = await render(
      <AiFeatureSharedNavigationStateProvider>
        <AiFeatureFlow
          consent={consent}
          services={{
            ...createAiFeatureServices(consent),
            sendRagMessage,
            prepareVisitQuestionTurn: input =>
              prepare({
                ...input,
                resolveSelectedAi: async () => ({
                  status: 'ready',
                  selection,
                  option,
                  provider,
                  modelId: selection.modelId,
                  recipient: 'on-device',
                  remoteProcessing: false,
                }),
              }),
          }}
          isEntryCurrent={() => true}
          onOpenArticle={jest.fn()}
          navigation={{
            route: { name: 'rag-conversation', key: 'root' },
            push: jest.fn(),
            replace: jest.fn(),
            onBack: jest.fn(),
            onHome: jest.fn(),
            registerLeaveState: () => () => {},
          }}
        />
      </AiFeatureSharedNavigationStateProvider>,
    );
    try {
      await fireEvent.press(
        screen.getByTestId('conversation-open-visit-questions'),
      );
      await waitFor(() => expect(stream).toHaveBeenCalledTimes(2));
      expect(screen.queryByTestId(openingId)).toBeNull();
      await act(async () => review.open());
      await waitFor(() => expect(stream).toHaveBeenCalledTimes(3));
      const firstReply = await screen.findByTestId(openingId);
      expect(firstReply).toBeVisible();
      expect(firstReply).toHaveTextContent(opening);
      expect(marks).toContain('opening_display:completed');
      expect(screen.queryByTestId('inline-visit-review')).toBeNull();
      expect(screen.queryByTestId('rag-conversation-error')).toBeNull();
      const payload = serializeAppleRequest(stream.mock.calls[2]![0]);
      expect(payload.toolNames).toContain('artifact-personal-source');
      expect(payload.toolNames).toContain(
        'visit-question-personal-record-search',
      );
      await act(async () => main.open());
      if (outcome === 'ready') {
        expect(await screen.findByTestId('inline-visit-review')).toBeTruthy();
        expect(screen.getByDisplayValue(question)).toBeTruthy();
        expect(searchEvidence).toHaveBeenCalledTimes(1);
      } else {
        const key =
          outcome === 'assets-lost'
            ? 'ragConversation.failureProviderUnavailable'
            : 'ragConversation.failureProviderConfiguration';
        expect(await screen.findByText(t(key))).toBeTruthy();
        expect(screen.queryByTestId('inline-visit-review')).toBeNull();
      }
      expect(stream).toHaveBeenCalledTimes(outcome === 'unsupported' ? 3 : 4);
      expect(screen.getByTestId(openingId)).toHaveTextContent(opening);
      expect(sendRagMessage).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
      expect(consent.authorize).not.toHaveBeenCalled();
    } finally {
      review.open();
      main.open();
      await view.unmount();
      restore();
    }
  },
);
