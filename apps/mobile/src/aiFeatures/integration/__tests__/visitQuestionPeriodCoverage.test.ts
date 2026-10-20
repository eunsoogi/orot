import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import { loadVisitQuestionsContext } from '../visitQuestionsContextLoader';
import { runVisitQuestionWorkflow } from '../../../agent/visitQuestions/workflow';
import {
  preparedContext,
  makeProvider,
  selectedOption,
} from '../../../agent/visitQuestions/testing/workflowFixtures';

jest.mock('../visitQuestionsContextLoader', () => ({
  loadVisitQuestionsContext: jest.fn(),
}));
jest.mock('../../../agent/visitQuestions/workflow', () => ({
  runVisitQuestionWorkflow: jest.fn(),
}));

test('retains an actual period coverage gap in the review screen instead of losing it at the route boundary', async () => {
  const context = preparedContext();
  const tool = {
    id: 'local-health-context',
    sourceKind: 'personal_record' as const,
    execution: 'local_read_only' as const,
    description: 'Synthetic bounded period',
    inputSchema: { type: 'object' as const },
    parseInput: () => ({}),
    search: async () => ({
      items: [],
      coverage: [
        {
          sourceKind: 'personal_record' as const,
          searchedSourceIds: [],
          gaps: ['topic_result_limit_reached'],
          truncated: true,
          resultLimit: 1,
          returnedCount: 0,
        },
      ],
      conflicts: [],
    }),
  };
  jest.mocked(loadVisitQuestionsContext).mockResolvedValue({
    prepareUpcomingVisitQuestionContext: async () => ({
      ...context,
      healthContextTool: tool,
      saveReviewedQuestions: jest.fn(),
    }),
  } as never);
  jest.mocked(runVisitQuestionWorkflow).mockImplementation(async input => {
    await input.prepared.healthContextTool!.search({
      operationRunId: 'synthetic',
      operationKey: 'period',
      input: {},
      allowedScope: { sourceKinds: ['personal_record'] },
      resultLimit: 1,
      maxPayloadBytes: 32768,
      signal: new AbortController().signal,
    });
    return {
      status: 'ready',
      questions: [],
      memoryStatus: 'not_searched',
    } as never;
  });
  const { provider } = makeProvider([]);
  const { selection, option } = selectedOption(provider);
  const result = await defaultVisitQuestionRouteOperations.generate({
    appointment: context.appointment,
    selectedAi: {
      status: 'ready',
      selection,
      option,
      recipient: 'Synthetic account',
    } as never,
    confirmConsent: async () => true,
    signal: new AbortController().signal,
  });
  expect(result).toMatchObject({
    status: 'ready',
    caveats: expect.arrayContaining([
      'incomplete_coverage',
      'truncated_results',
    ]),
  });
});
