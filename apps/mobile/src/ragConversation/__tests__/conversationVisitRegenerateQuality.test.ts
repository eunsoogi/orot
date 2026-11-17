import {
  appointment,
  candidate,
} from '../../agent/visitQuestions/testing/persistenceFixtures';
import {
  makeProvider,
  preparedContext,
  selectedOption,
} from '../../agent/visitQuestions/testing/workflowFixtures';
import { suggestionOutput } from '../../agent/visitQuestions/testing/responseCorrectionFixtures';
import { runVisitQuestionWorkflow } from '../../agent/visitQuestions/workflow';
import { createInlineVisitReview } from '../../nextVisitQuestions/inlineVisitReview';
import { createConversationSessions } from '../conversationSessions';
import { regenerateVisitQuestions } from '../conversationVisitRegenerate';
import { createConversationVisitTurn } from '../../aiFeatures/integration/conversationVisitTurn';
import { defaultVisitQuestionRouteOperations } from '../../aiFeatures/integration/visitQuestionsRouteOperations';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import type { ConversationScreenProps } from '../ConversationScreenProps';

jest.mock('../../aiFeatures/integration/contextualConversationOpening', () => ({
  // An unavailable opening still returns its settled lifecycle handle in production.
  startContextualConversationOpening: () => ({
    done: Promise.resolve(),
    dispose: jest.fn(),
  }),
}));
jest.mock('../../aiFeatures/integration/visitQuestionsRouteOperations', () => ({
  defaultVisitQuestionRouteOperations: {
    loadAppointment: jest.fn(),
    generate: jest.fn(),
  },
}));

/** Keep storage preparation synthetic while running real regenerate dispatch, turn ownership and task validation. */
test('regeneration uses the same decision prompt and bounded quality correction as an initial turn', async () => {
  const store = createConversationSessions();
  const oldReview = createInlineVisitReview(
    'old',
    [],
    [candidate],
    [],
    () => 'original',
  );
  store.setDraft(1, '합성 진료 질문을 준비해 주세요');
  await store.send(1, async () => ({
    status: 'answer',
    answer: '이전 합성 결과',
    citations: [],
    visitQuestions: {
      appointment,
      review: oldReview,
      validateSource: async () => true,
    },
  }));
  const message = store.getSnapshot().sessions[0]!.messages[1]!;
  const { provider, requests } = makeProvider([
    suggestionOutput('기록이 정확한지 어떤 방법으로 확인하나요?'),
    suggestionOutput('수면 변화와 관련해 어떤 점을 관찰하면 좋을까요?'),
  ]);
  const { selection, option } = selectedOption(provider, 'on-device');
  jest
    .mocked(defaultVisitQuestionRouteOperations.loadAppointment)
    .mockResolvedValue(appointment);
  jest
    .mocked(defaultVisitQuestionRouteOperations.generate)
    .mockImplementation(async input => {
      // Preserve the real preflight gate before this synthetic workflow dispatch.
      if (input.beforeResearch && !(await input.beforeResearch()))
        return { status: 'cancelled' };
      const result = await runVisitQuestionWorkflow({
        prepared: preparedContext(),
        request: input.request,
        selection,
        providerOptions: [option],
        signal: input.signal,
      });
      if (result.status !== 'ready')
        throw new Error('Synthetic workflow did not produce ready questions');
      return {
        status: 'ready',
        questions: result.questions,
        caveats: [],
        validateSource: async () => true,
      };
    });
  const turn = createConversationVisitTurn({
    loadLocalData: jest.fn(),
    registry: new LocalEvidenceReferenceRegistry(),
    loadSaved: async () => ({
      status: 'ready',
      appointmentId: appointment.id,
      questions: [],
      caveats: [],
      restorationNotice: '',
    }),
    registerSource: jest.fn(),
  });
  const prepare: NonNullable<
    ConversationScreenProps['prepareVisitQuestions']
  > = (question, _history, signal, _observer, context) =>
    turn({
      question,
      context,
      signal: signal!,
      resolveSelectedAi: async () => ({
        status: 'ready',
        provider,
        selection,
        option,
        recipient: 'Synthetic local provider',
        modelId: selection.modelId,
        remoteProcessing: false,
      }),
      confirmConsent: async () => true,
    });
  try {
    regenerateVisitQuestions({ store, sessionId: 1, message, prepare });
    for (
      let step = 0;
      step < 100 && store.getSnapshot().sessions[0]!.busy;
      step += 1
    )
      await new Promise<void>(resolve => setImmediate(resolve));
    expect(store.getSnapshot().sessions[0]!.busy).toBe(false);
    expect(requests).toHaveLength(2);
    expect(JSON.stringify(requests[0]!.messages)).toContain(
      'Do not turn ordinary variation',
    );
    expect(JSON.stringify(requests[1]!.messages)).toContain(
      'Never invent a concern or pad a count',
    );
    const messages = store.getSnapshot().sessions[0]!.messages;
    expect(messages[1]!.visitQuestions!.review).toEqual(oldReview);
    expect(
      messages.at(-1)!.visitQuestions!.review.items[0]!.question.questionText,
    ).toBe('수면 변화와 관련해 어떤 점을 관찰하면 좋을까요?');
  } finally {
    store.dispose();
  }
});
