import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import { loadVisitQuestionsContext } from '../visitQuestionsContextLoader';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../../../agent/visitQuestions/testing/workflowFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import { providerFailure } from '@orot/model-runtime';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';

jest.mock('../visitQuestionsContextLoader', () => ({
  loadVisitQuestionsContext: jest.fn(),
}));

test('the real visit workflow searches once and keeps generated citations local', async () => {
  const prepared = preparedContext();
  const fixture = publicEvidenceFixture();
  const model = makeProvider(
    successfulOutputs(prepared.initialEvidence, prepared.supplementalEvidence),
  );
  const provider = { ...model.provider, searchPublicWeb: fixture.search };
  const { selection, option } = selectedOption(provider);
  jest.mocked(loadVisitQuestionsContext).mockResolvedValue({
    prepareUpcomingVisitQuestionContext: async () => ({
      ...prepared,
      saveReviewedQuestions: jest.fn(),
    }),
  } as never);
  const confirmConsent = jest.fn(async () => true);
  const result = await defaultVisitQuestionRouteOperations.generate({
    appointment: prepared.appointment,
    selectedAi: {
      status: 'ready',
      selection,
      option,
      provider,
      modelId: selection.modelId,
      recipient: 'Synthetic account',
      remoteProcessing: true,
    },
    confirmConsent,
    signal: new AbortController().signal,
  });
  expect(fixture.search).toHaveBeenCalledTimes(1);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready')
    throw new Error('Expected reviewable questions');
  expect(result.caveats).toContain('public_search_not_retained');
  expect(result.questions).toHaveLength(3);
  expect(
    result.questions
      .flatMap(question => question.citations)
      .every(citation => citation.sourceKind !== 'external_medical'),
  ).toBe(true);
  expect(model.requests).toHaveLength(2);
  expect(JSON.stringify(model.requests)).not.toContain(
    'Synthetic cited web explanation.',
  );
  expect(confirmConsent.mock.calls.length).toBeGreaterThanOrEqual(2);
});

test('preserves locally grounded questions when the public search attempt fails', async () => {
  const prepared = preparedContext();
  const fixture = publicEvidenceFixture();
  fixture.search.mockResolvedValue(
    providerFailure({
      code: 'provider_unavailable',
      message: 'Synthetic search failure',
      retryable: true,
    }),
  );
  const model = makeProvider(
    successfulOutputs(prepared.initialEvidence, prepared.supplementalEvidence),
  );
  const provider = { ...model.provider, searchPublicWeb: fixture.search };
  const { selection, option } = selectedOption(provider);
  jest.mocked(loadVisitQuestionsContext).mockResolvedValue({
    prepareUpcomingVisitQuestionContext: async () => ({
      ...prepared,
      saveReviewedQuestions: jest.fn(),
    }),
  } as never);
  const result = await defaultVisitQuestionRouteOperations.generate({
    appointment: prepared.appointment,
    selectedAi: {
      status: 'ready',
      selection,
      option,
      provider,
      modelId: selection.modelId,
      recipient: 'Synthetic account',
      remoteProcessing: true,
    },
    confirmConsent: async () => true,
    signal: new AbortController().signal,
  });
  expect(fixture.search).toHaveBeenCalledTimes(1);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('Local questions were lost.');
  expect(result.questions).toHaveLength(3);
  expect(result.caveats).toContain('public_search_failed');
  expect(
    result.questions.every(question => question.citations.length > 0),
  ).toBe(true);
  expect(
    result.questions
      .flatMap(question => question.citations)
      .every(citation => citation.sourceKind === 'personal_record'),
  ).toBe(true);
});

test.each([
  ['public_web_search', 'ready', 0, 2],
  ['visit_questions', 'consent_required', 1, 0],
] as const)(
  'denying %s never authorizes that operation through the other consent',
  async (deniedPurpose, expectedStatus, expectedSearches, expectedModels) => {
    const prepared = preparedContext();
    const fixture = publicEvidenceFixture();
    const model = makeProvider(
      successfulOutputs(
        prepared.initialEvidence,
        prepared.supplementalEvidence,
      ),
    );
    const provider = { ...model.provider, searchPublicWeb: fixture.search };
    const { selection, option } = selectedOption(provider);
    jest.mocked(loadVisitQuestionsContext).mockResolvedValue({
      prepareUpcomingVisitQuestionContext: async () => ({
        ...prepared,
        saveReviewedQuestions: jest.fn(),
      }),
    } as never);
    const requests: OutboundProcessingRequest[] = [];
    const result = await defaultVisitQuestionRouteOperations.generate({
      appointment: prepared.appointment,
      selectedAi: {
        status: 'ready',
        selection,
        option,
        provider,
        modelId: selection.modelId,
        recipient: 'Synthetic account',
        remoteProcessing: true,
      },
      confirmConsent: async request => {
        requests.push(request);
        return Boolean(
          request.consentScope &&
          request.consentScope.purpose !== deniedPurpose,
        );
      },
      signal: new AbortController().signal,
    });
    expect(result.status).toBe(expectedStatus);
    expect(fixture.search).toHaveBeenCalledTimes(expectedSearches);
    expect(model.requests).toHaveLength(expectedModels);
    expect(requests.map(request => request.consentScope?.purpose)).toEqual(
      expect.arrayContaining(['public_web_search', 'visit_questions']),
    );
    if (result.status === 'ready') {
      expect(result.questions).toHaveLength(3);
      expect(result.caveats).toContain('public_search_consent_required');
    }
  },
);
