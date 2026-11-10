import {
  appointment,
  candidate,
} from '../../../agent/visitQuestions/testing/persistenceFixtures';
import { generateConversationVisitQuestions } from '../conversationVisitQuestions';
import { createInlineVisitReview } from '../../../nextVisitQuestions/inlineVisitReview';
import type { SelectedAiResolution } from '../provider';
import type { VisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';

const selected = { status: 'ready' } as SelectedAiResolution;

test('uses the selected visit and submitted request when creating a review', async () => {
  const validateSource = jest.fn(async () => true);
  const loadAppointment = jest.fn(async () => appointment);
  const generate = jest.fn(async () => ({
    status: 'ready' as const,
    questions: [candidate],
    caveats: [],
    validateSource,
  }));
  const loadSaved = jest.fn(async () => ({
    status: 'ready' as const,
    appointmentId: appointment.id,
    questions: [],
    caveats: [] as const,
    restorationNotice: '',
  }));
  const result = await generateConversationVisitQuestions({
    ownerKey: 'session:turn',
    appointmentId: appointment.id,
    request: '편집한 요청',
    operations: {
      loadAppointment,
      generate,
    } as unknown as VisitQuestionRouteOperations,
    loadSaved,
    resolveSelectedAi: async () => selected,
    confirmConsent: async () => true,
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
  });
  expect(loadAppointment).toHaveBeenCalledWith(
    expect.any(String),
    appointment.id,
  );
  expect(generate).toHaveBeenCalledWith(
    expect.objectContaining({
      appointment,
      request: '편집한 요청',
      selectedAi: selected,
    }),
  );
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('expected review');
  expect(result.review.items[0]?.selected).toBe(false);
  expect(result.generation.validateSource).toBe(validateSource);
});

test('does not invoke the provider when the selected visit is absent', async () => {
  const resolveSelectedAi = jest.fn(async () => selected);
  const generate = jest.fn();
  const result = await generateConversationVisitQuestions({
    ownerKey: 'session:turn',
    appointmentId: 'missing',
    request: '요청',
    operations: {
      loadAppointment: async () => null,
      generate,
    } as unknown as VisitQuestionRouteOperations,
    loadSaved: jest.fn(),
    resolveSelectedAi,
    confirmConsent: async () => true,
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
  });
  expect(result.status).toBe('no_appointment');
  expect(resolveSelectedAi).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

test('does not silently select the next visit when no target was chosen', async () => {
  const loadAppointment = jest.fn(async () => appointment);
  const resolveSelectedAi = jest.fn(async () => selected);
  const result = await generateConversationVisitQuestions({
    ownerKey: 'session:turn',
    request: '요청',
    operations: {
      loadAppointment,
      generate: async () => ({
        status: 'ready',
        questions: [candidate],
        caveats: [],
        validateSource: async () => true,
      }),
    } as unknown as VisitQuestionRouteOperations,
    loadSaved: async () => ({
      status: 'ready',
      appointmentId: appointment.id,
      questions: [],
      caveats: [],
      restorationNotice: '',
    }),
    resolveSelectedAi,
    confirmConsent: async () => true,
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
  });
  expect(result.status).toBe('no_appointment');
  expect(loadAppointment).not.toHaveBeenCalled();
  expect(resolveSelectedAi).not.toHaveBeenCalled();
});

test('rejects regeneration after the appointment changes without replacing the draft', async () => {
  const review = createInlineVisitReview(
    'session:turn',
    [],
    [candidate],
    [],
    () => 'draft',
  );
  const generate = jest.fn();
  const result = await generateConversationVisitQuestions({
    ownerKey: 'session:turn',
    appointmentId: appointment.id,
    request: '요청',
    expectedAppointment: appointment,
    operations: {
      loadAppointment: async () => ({ ...appointment, clinicLabel: 'changed' }),
      generate,
    } as unknown as VisitQuestionRouteOperations,
    loadSaved: jest.fn(),
    resolveSelectedAi: async () => selected,
    confirmConsent: async () => true,
    isCurrentOwner: () => true,
    signal: new AbortController().signal,
  });
  expect(result.status).toBe('appointment_changed');
  expect(generate).not.toHaveBeenCalled();
  expect(review.items[0]?.question.identity?.id).toBe('draft');
});
