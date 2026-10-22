import { defaultVisitQuestionRouteOperations } from '../visitQuestionsRouteOperations';
import { loadVisitQuestionsContext } from '../visitQuestionsContextLoader';
import { runVisitQuestionWorkflow } from '../../../agent/visitQuestions/workflow';
import {
  preparedContext,
  makeProvider,
  selectedOption,
} from '../../../agent/visitQuestions/testing/workflowFixtures';
import { visitHealthFixture } from '../../../agent/visitQuestions/testing/healthContextFixture';
import {
  healthObservation,
  medicationDefinition,
} from '../../../../../../packages/storage/__tests__/localQueryTestSupport';

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

test.each([
  ['measurements', 'quantity_sensor_series_limit_reached', true],
  ['medications', 'medication_catalog_limit_reached', true],
  ['sleep', 'unsupported_sleep_categories_excluded_from_duration', false],
  ['measurements', undefined, false],
] as const)(
  'propagates actual %s reader limitations (%s) to review caveats',
  async (topic, limitation, truncated) => {
    jest.useFakeTimers({ now: Date.parse('2026-10-05T12:00:00Z') });
    const f = await visitHealthFixture(topic);
    try {
      if (limitation === 'quantity_sensor_series_limit_reached') {
        for (let index = 0; index < 13; index++) {
          const row = healthObservation(
            `sensor-${index}`,
            'heart_rate',
            '2026-10-01T03:00:00Z',
          );
          await f.records.put('health_observation', {
            ...row,
            provenance: {
              ...row.provenance,
              source: {
                system: 'healthkit',
                sourceIdentifier: `com.example.sensor${index}`,
              },
            },
          });
        }
      } else if (limitation === 'medication_catalog_limit_reached') {
        for (let index = 0; index < 33; index++)
          await f.records.put(
            'medication_definition',
            medicationDefinition(`catalog-${index}`, '2026-09-01T00:00:00Z'),
          );
      } else if (limitation) {
        await f.records.put('health_observation', {
          ...healthObservation(
            'unknown-sleep',
            'HKCategoryTypeIdentifierSleepAnalysis',
            '2026-10-01T03:00:00Z',
          ),
          endedAt: '2026-10-01T04:00:00Z',
          value: { kind: 'text', text: '999' },
        });
      }
      const report = await f.read(f.report.window, [topic]);
      expect(report.limitations).toEqual(limitation ? [limitation] : []);
      jest.mocked(loadVisitQuestionsContext).mockResolvedValue({
        prepareUpcomingVisitQuestionContext: async () => ({
          ...f.prepared,
          saveReviewedQuestions: jest.fn(),
        }),
      } as never);
      jest.mocked(runVisitQuestionWorkflow).mockImplementation(async input => {
        const batch = await input.prepared.healthContextTool!.search({
          operationRunId: 'synthetic',
          operationKey: 'actual-period',
          input: { topics: [topic] },
          allowedScope: { sourceKinds: ['personal_record'] },
          resultLimit: 1,
          maxPayloadBytes: 32768,
          signal: new AbortController().signal,
        });
        if ('status' in batch)
          throw new Error('Expected actual computed facts.');
        expect(batch.coverage[0]?.gaps).toEqual(limitation ? [limitation] : []);
        expect(batch.coverage[0]?.truncated).toBe(truncated);
        return {
          status: 'ready',
          questions: [],
          memoryStatus: 'not_searched',
        } as never;
      });
      const { provider } = makeProvider([]);
      const { selection, option } = selectedOption(provider);
      const result = await defaultVisitQuestionRouteOperations.generate({
        appointment: f.prepared.appointment,
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
        caveats: limitation
          ? truncated
            ? ['incomplete_coverage', 'truncated_results']
            : ['incomplete_coverage']
          : [],
      });
    } finally {
      f.close();
      jest.useRealTimers();
    }
  },
);
