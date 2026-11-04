import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import { loadVisitQuestionsContext } from '../visitQuestionsContextLoader';
import {
  makeProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../../../agent/visitQuestions/testing/workflowFixtures';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

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
