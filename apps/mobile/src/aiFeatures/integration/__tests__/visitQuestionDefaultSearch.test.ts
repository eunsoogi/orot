import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import { loadVisitQuestionsContext } from '../visitQuestionsContextLoader';
import { runVisitQuestionWorkflow } from '../../../agent/visitQuestions/workflow';
import { preparedContext } from '../../../agent/visitQuestions/testing/workflowFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { providerFailure } from '@orot/model-runtime';
import { visitQuestionPublicSearch } from '../visitQuestionPublicSearch';

jest.mock('../visitQuestionsContextLoader', () => ({
  loadVisitQuestionsContext: jest.fn(),
}));
jest.mock('../../../agent/visitQuestions/workflow', () => ({
  runVisitQuestionWorkflow: jest.fn(),
}));
beforeEach(() => jest.clearAllMocks());

test('reports only a typed offline cause and keeps public queries free of private input', async () => {
  const run = setup();
  run.search.mockResolvedValue(
    providerFailure({
      code: 'provider_unavailable',
      message: 'synthetic',
      retryable: true,
      connectivity: 'offline',
    }),
  );
  const result = await run.generate();
  expect(result).toMatchObject({
    status: 'ready',
    caveats: expect.arrayContaining(['public_search_offline']),
  });
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(run.search.mock.calls[0]![0].query).not.toMatch(/김테스트|170\/100/);
});

test('does not send a public request or ask for consent with a local-only selection', async () => {
  const run = publicEvidenceFixture();
  const confirm = jest.fn(async () => true);
  const result = await visitQuestionPublicSearch({
    selected: { ...run.selected, remoteProcessing: false },
    confirm,
    query: 'Synthetic blood pressure',
    signal: run.controller.signal,
  });
  expect(run.search).not.toHaveBeenCalled();
  expect(confirm).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    result: { status: 'unavailable' },
    caveat: 'public_search_not_configured',
    spentModelCall: false,
  });
});

test('identifies missing search capability without asking consent or making a request', async () => {
  const run = publicEvidenceFixture();
  const { searchPublicWeb: _search, ...provider } = run.selected.provider;
  expect(_search).toBe(run.search);
  const confirm = jest.fn(async () => true);
  const result = await visitQuestionPublicSearch({
    selected: { ...run.selected, provider },
    confirm,
    query: 'Synthetic blood pressure',
    signal: run.controller.signal,
  });
  expect(result).toMatchObject({
    result: { status: 'unavailable' },
    caveat: 'public_search_unsupported',
    spentModelCall: false,
  });
  expect(confirm).not.toHaveBeenCalled();
  expect(run.search).not.toHaveBeenCalled();
});

function setup(allow = true) {
  const run = publicEvidenceFixture();
  const context = preparedContext();
  const prepared = {
    ...context,
    query: '김테스트 혈압 170/100',
    saveReviewedQuestions: jest.fn(),
  };
  jest.mocked(loadVisitQuestionsContext).mockResolvedValue({
    prepareUpcomingVisitQuestionContext: async () => prepared,
  } as never);
  jest.mocked(runVisitQuestionWorkflow).mockResolvedValue({
    status: 'ready',
    questions: [],
    memoryStatus: 'available',
  } as never);
  const confirmConsent = jest.fn(async () => allow);
  return {
    ...run,
    context,
    confirmConsent,
    generate: () =>
      defaultVisitQuestionRouteOperations.generate({
        appointment: context.appointment,
        selectedAi: run.selected,
        confirmConsent,
        signal: run.controller.signal,
      }),
  };
}

test('searches public topics before local-only visit generation and reports the source limitation', async () => {
  const run = setup();
  const result = await run.generate();
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(run.search.mock.calls[0]![0].query).toContain('blood pressure');
  expect(run.search.mock.calls[0]![0].query).not.toMatch(/김테스트|170\/100/);
  expect(run.search.mock.invocationCallOrder[0]).toBeLessThan(
    jest.mocked(runVisitQuestionWorkflow).mock.invocationCallOrder[0]!,
  );
  expect(
    jest.mocked(runVisitQuestionWorkflow).mock.calls[0]![0]
      .reservedPublicSearchCall,
  ).toBe(true);
  expect(result).toMatchObject({
    status: 'ready',
    caveats: expect.arrayContaining(['public_search_not_retained']),
  });
});

test('continues local generation and reports denied search without a network call', async () => {
  const run = setup(false);
  const result = await run.generate();
  expect(run.search).not.toHaveBeenCalled();
  expect(
    jest.mocked(runVisitQuestionWorkflow).mock.calls[0]![0]
      .reservedPublicSearchCall,
  ).toBe(false);
  expect(result).toMatchObject({
    status: 'ready',
    caveats: expect.arrayContaining(['public_search_consent_required']),
  });
});

test('treats a failed consent prompt as requiring consent', async () => {
  const run = setup();
  run.confirmConsent.mockRejectedValueOnce(new Error('prompt unavailable'));
  const result = await run.generate();
  expect(run.search).not.toHaveBeenCalled();
  expect(result).toMatchObject({
    status: 'ready',
    caveats: expect.arrayContaining(['public_search_consent_required']),
  });
});

test('continues local generation when the selected public provider is unavailable', async () => {
  const run = setup();
  run.search.mockResolvedValue(
    providerFailure({
      code: 'provider_unavailable',
      message: 'unavailable',
      retryable: true,
    }),
  );
  const result = await run.generate();
  expect(result).toMatchObject({
    status: 'ready',
    caveats: expect.arrayContaining(['public_search_failed']),
  });
  expect(jest.mocked(runVisitQuestionWorkflow)).toHaveBeenCalledTimes(1);
});

test('canceling the search stops before visit generation', async () => {
  const run = setup();
  let started!: () => void;
  const dispatched = new Promise<void>(resolve => {
    started = resolve;
  });
  run.search.mockImplementation(
    (_request, options) =>
      new Promise(resolve => {
        started();
        options?.signal?.addEventListener('abort', () =>
          resolve(
            providerFailure({
              code: 'provider_unavailable',
              message: 'cancelled',
              retryable: false,
            }),
          ),
        );
      }),
  );
  const pending = run.generate();
  await dispatched;
  run.controller.abort();
  await expect(pending).resolves.toEqual({ status: 'cancelled' });
  expect(jest.mocked(runVisitQuestionWorkflow)).not.toHaveBeenCalled();
});

test('does not turn an unneeded question list into a claim that records are missing', async () => {
  const run = setup();
  const message = '이번 진료에서 상의하고 싶은 구체적인 목표가 있나요?';
  jest.mocked(runVisitQuestionWorkflow).mockResolvedValue({
    status: 'needs_clarification',
    message,
    memoryStatus: 'available',
  });
  const result = await run.generate();
  expect(result).toMatchObject({ status: 'needs_clarification', message });
  if (result.status === 'cancelled') throw new Error('Unexpected cancellation');
  expect(result.caveats).not.toContain('insufficient_evidence');
});

test('keeps actual zero-coverage warnings and the validated insufficient-evidence explanation', async () => {
  const run = setup();
  const batch = run.context.evidence.batch;
  Object.assign(batch, {
    items: [],
    coverage: [
      {
        sourceKind: 'personal_record',
        searchedSourceIds: [],
        gaps: ['synthetic_missing_period'],
        truncated: true,
        resultLimit: 1,
        returnedCount: 0,
      },
    ],
  });
  const message =
    '확인할 수 있는 합성 자료가 부족해 진료 질문을 정하기 어려워요?';
  jest.mocked(runVisitQuestionWorkflow).mockResolvedValue({
    status: 'needs_clarification',
    message,
    memoryStatus: 'available',
  });
  expect(await run.generate()).toMatchObject({
    status: 'needs_clarification',
    message,
    caveats: expect.arrayContaining([
      'incomplete_coverage',
      'truncated_results',
    ]),
  });
});
