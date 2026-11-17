import { generateConversationVisitQuestions } from '../conversationVisitQuestions';
import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import { startContextualConversationOpening } from '../contextualConversationOpening';
import { loadVisitQuestionsContext } from '../visitQuestionsContextLoader';
import { runVisitQuestionWorkflow } from '../../../agent/visitQuestions/workflow';
import { preparedContext } from '../../../agent/visitQuestions/testing/workflowFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

jest.mock('../contextualConversationOpening', () => ({
  startContextualConversationOpening: jest.fn(),
}));
jest.mock('../visitQuestionsContextLoader', () => ({
  loadVisitQuestionsContext: jest.fn(),
}));
jest.mock('../../../agent/visitQuestions/workflow', () => ({
  runVisitQuestionWorkflow: jest.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function setup(openingConsent = false) {
  jest.clearAllMocks();
  const run = publicEvidenceFixture();
  const context = preparedContext();
  const opening = deferred<void>();
  const prepared = deferred<void>();
  const dispose = jest.fn();
  let authorizeOpening: Promise<unknown> | undefined;
  const request = { signal: run.controller.signal } as Parameters<
    Parameters<
      typeof startContextualConversationOpening
    >[0]['consent']['authorize']
  >[0];
  let current = true;
  jest.mocked(startContextualConversationOpening).mockImplementation(input => {
    if (openingConsent) authorizeOpening = input.consent.authorize(request);
    return { done: opening.promise, dispose };
  });
  const prepare = jest.fn(async () => {
    prepared.resolve();
    return { ...context, saveReviewedQuestions: jest.fn() };
  });
  jest.mocked(loadVisitQuestionsContext).mockResolvedValue({
    prepareUpcomingVisitQuestionContext: prepare,
  } as never);
  jest
    .mocked(runVisitQuestionWorkflow)
    .mockResolvedValue({ status: 'needs_clarification' } as never);
  const consent = jest.fn(async () => true);
  const result = generateConversationVisitQuestions({
    ownerKey: 'synthetic-owner',
    request: '합성 진료 질문',
    operations: {
      ...defaultVisitQuestionRouteOperations,
      loadAppointment: async () => context.appointment,
    },
    loadSaved: async () => ({
      status: 'ready',
      appointmentId: context.appointment.id,
      questions: [],
      caveats: [],
      restorationNotice: '',
    }),
    resolveSelectedAi: async () => run.selected,
    confirmConsent: consent,
    isCurrentOwner: () => current,
    signal: run.controller.signal,
  });
  return {
    ...run,
    context,
    opening,
    prepared,
    prepare,
    dispose,
    consent,
    result,
    request,
    openingAuthorization: () => authorizeOpening,
    supersede: () => {
      current = false;
    },
  };
}

// Synthetic unresolved opening proves overlap and ordering without model or device access.
test('prepares locally during opening but starts consent and research only after it settles', async () => {
  const f = setup();
  await f.prepared.promise;
  expect(f.prepare).toHaveBeenCalledTimes(1);
  expect(f.consent).not.toHaveBeenCalled();
  expect(f.search).not.toHaveBeenCalled();
  expect(runVisitQuestionWorkflow).not.toHaveBeenCalled();
  f.opening.resolve();
  await f.result;
  expect(f.consent).toHaveBeenCalledTimes(1);
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(runVisitQuestionWorkflow).toHaveBeenCalledTimes(1);
  expect(f.dispose).toHaveBeenCalledTimes(1);
});

test.each(['cancel', 'supersede'] as const)(
  'does not dispatch after %s while opening is pending',
  async action => {
    const f = setup();
    await f.prepared.promise;
    if (action === 'cancel') f.controller.abort();
    else f.supersede();
    f.opening.resolve();
    expect(await f.result).toEqual({ status: 'cancelled' });
    expect(f.consent).not.toHaveBeenCalled();
    expect(f.search).not.toHaveBeenCalled();
    expect(runVisitQuestionWorkflow).not.toHaveBeenCalled();
    expect(f.dispose).toHaveBeenCalledTimes(1);
  },
);

test('denied public-search consent is not bypassed by local overlap', async () => {
  const f = setup();
  f.consent.mockResolvedValue(false);
  await f.prepared.promise;
  f.opening.resolve();
  await f.result;
  expect(f.search).not.toHaveBeenCalled();
  expect(runVisitQuestionWorkflow).toHaveBeenCalledWith(
    expect.objectContaining({ reservedPublicSearchCall: false }),
  );
});

test('revalidates the prepared appointment after opening before any outbound consent', async () => {
  const f = setup();
  await f.prepared.promise;
  jest.mocked(f.context.revalidateEvidence).mockResolvedValue(false);
  f.opening.resolve();
  expect(await f.result).toMatchObject({ status: 'refresh_required' });
  expect(f.context.revalidateEvidence).toHaveBeenCalledWith([], {
    allowEmpty: true,
  });
  expect(f.consent).not.toHaveBeenCalled();
  expect(f.search).not.toHaveBeenCalled();
  expect(runVisitQuestionWorkflow).not.toHaveBeenCalled();
});

test('an owner change during appointment revalidation cannot dispatch research', async () => {
  const f = setup();
  await f.prepared.promise;
  jest.mocked(f.context.revalidateEvidence).mockImplementation(async () => {
    f.supersede();
    return true;
  });
  f.opening.resolve();
  expect(await f.result).toEqual({ status: 'cancelled' });
  expect(f.consent).not.toHaveBeenCalled();
  expect(f.search).not.toHaveBeenCalled();
  expect(runVisitQuestionWorkflow).not.toHaveBeenCalled();
});

// Exercise the actual per-request gate, rather than only a mocked opening wait.
test('a failed local preparation never exposes opening consent and releases its waiter', async () => {
  const f = setup(true);
  const error = new Error('synthetic local failure');
  f.prepare.mockRejectedValueOnce(error);
  await expect(f.result).rejects.toBe(error);
  await expect(f.openingAuthorization()).resolves.toBe('renewal_required');
  expect(f.consent).not.toHaveBeenCalled();
  expect(f.search).not.toHaveBeenCalled();
  expect(runVisitQuestionWorkflow).not.toHaveBeenCalled();
  expect(f.dispose).toHaveBeenCalledTimes(1);
});

test('prepared opening forwards its exact consent request without starting research early', async () => {
  const f = setup(true);
  await f.prepared.promise;
  await expect(f.openingAuthorization()).resolves.toBe('authorized');
  expect(f.consent).toHaveBeenCalledTimes(1);
  expect(f.consent).toHaveBeenCalledWith(f.request);
  expect(f.search).not.toHaveBeenCalled();
  f.opening.resolve();
  await f.result;
  expect(f.search).toHaveBeenCalledTimes(1);
});
