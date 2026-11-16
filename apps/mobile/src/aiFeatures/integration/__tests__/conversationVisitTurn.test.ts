import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createConversationVisitTurn } from '../conversationVisitTurn';
import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import type { SelectedAiResolution } from '../provider';
import type { ConversationEntryContext } from '../conversationIntent';

jest.mock('../visitQuestionsRouteOperations', () => ({
  defaultVisitQuestionRouteOperations: {
    loadAppointment: jest.fn(async () => ({ id: 'appointment-1' })),
    generate: jest.fn(),
  },
}));

test('passes typed saved-question recovery to the conversation result', async () => {
  const selected = { status: 'ready' } as SelectedAiResolution;
  const confirmConsent = jest.fn(async () => true);
  const turn = createConversationVisitTurn({
    loadLocalData: jest.fn(),
    registry: new LocalEvidenceReferenceRegistry(),
    loadSaved: async () => ({
      status: 'error',
      appointmentId: 'appointment-1',
      questions: [],
      message: 'safe retry copy',
      failureReason: 'stale_artifact',
    }),
    registerSource: jest.fn() as never,
  });

  const result = await turn({
    question: 'synthetic visit question request',
    context: {
      intent: 'visit-questions',
      entryKey: 'synthetic-entry',
      appointmentId: 'appointment-1',
    } satisfies ConversationEntryContext,
    signal: new AbortController().signal,
    resolveSelectedAi: async () => selected,
    confirmConsent,
  });

  expect(result).toMatchObject({
    status: 'failure',
    kind: 'visit_saved_unavailable',
    visitQuestionRecovery: {
      status: 'stale_evidence',
      reason: 'stale_artifact',
      action: 'revalidate_saved_question_sources',
    },
  });
  expect(defaultVisitQuestionRouteOperations.generate).not.toHaveBeenCalled();
  expect(confirmConsent).not.toHaveBeenCalled();
});

/** A completed tool is not proof that the model produced an invalid answer. */
test.each([
  ['needs_clarification', undefined, { status: 'insufficient' }],
  ['unavailable', undefined, { status: 'failure', kind: 'unavailable' }],
  [
    'budget_exceeded',
    undefined,
    { status: 'failure', kind: 'budget_exceeded' },
  ],
  [
    'rejected_output',
    undefined,
    { status: 'failure', kind: 'validation_failed' },
  ],
  [
    'refresh_required',
    undefined,
    { status: 'failure', kind: 'stale_evidence' },
  ],
  [
    'consent_required',
    undefined,
    { status: 'failure', kind: 'consent_required' },
  ],
  ['cancelled', undefined, { status: 'failure', kind: 'cancelled' }],
  [
    'unavailable',
    'rate_limited',
    { status: 'failure', kind: 'provider_rate_limited' },
  ],
  [
    'unavailable',
    'authentication_required',
    { status: 'failure', kind: 'provider_authentication' },
  ],
  [
    'unavailable',
    'unsupported_capability',
    { status: 'failure', kind: 'provider_configuration' },
  ],
  [
    'unavailable',
    'safety_refusal',
    { status: 'failure', kind: 'provider_refused' },
  ],
] as const)(
  'preserves %s / %s without exposing raw failure text',
  async (status, providerErrorCode, expected) => {
    jest
      .mocked(defaultVisitQuestionRouteOperations.generate)
      .mockResolvedValue({
        status,
        message: 'PRIVATE_PROVIDER_TEXT',
        providerErrorCode,
      } as never);
    const turn = createConversationVisitTurn({
      loadLocalData: jest.fn(),
      registry: new LocalEvidenceReferenceRegistry(),
      loadSaved: async () => ({
        status: 'ready',
        appointmentId: 'appointment-1',
        questions: [],
        caveats: [],
        restorationNotice: '',
      }),
      registerSource: jest.fn() as never,
    });
    const result = await turn({
      question: 'synthetic question',
      signal: new AbortController().signal,
      resolveSelectedAi: async () =>
        ({ status: 'ready' }) as SelectedAiResolution,
      confirmConsent: async () => false,
    });
    expect(result).toEqual(expected);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_PROVIDER_TEXT');
  },
);

test('forwards reviewed initial responses through the explicit visit turn observer', async () => {
  const onTaskStreamEvent = jest.fn();
  const event = {
    type: 'initial_response' as const,
    callId: 'synthetic-preview',
    text: '질문을 함께 준비해 볼게요.',
  };
  jest
    .mocked(defaultVisitQuestionRouteOperations.generate)
    .mockImplementation(async input => {
      input.observer?.onTaskStreamEvent?.(event);
      return {
        status: 'needs_clarification',
        message: 'synthetic missing context',
      };
    });
  const turn = createConversationVisitTurn({
    loadLocalData: jest.fn(),
    registry: new LocalEvidenceReferenceRegistry(),
    registerSource: jest.fn() as never,
    loadSaved: async () => ({
      status: 'ready',
      appointmentId: 'appointment-1',
      questions: [],
      caveats: [],
      restorationNotice: '',
    }),
  });
  const result = await turn({
    question: 'synthetic question',
    signal: new AbortController().signal,
    resolveSelectedAi: async () =>
      ({ status: 'ready' }) as SelectedAiResolution,
    confirmConsent: async () => false,
    observer: { onTaskStreamEvent },
  });
  expect(result).toEqual({ status: 'insufficient' });
  expect(onTaskStreamEvent).toHaveBeenCalledTimes(1);
  expect(onTaskStreamEvent).toHaveBeenCalledWith(event);
});
