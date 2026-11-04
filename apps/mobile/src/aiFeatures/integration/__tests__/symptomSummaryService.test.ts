import { createAiFeatureServices } from '../featureServices';
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { diseaseHypothesisTask } from '../../../diseaseHypotheses/task';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { workflowOptions } from '../../../diseaseHypotheses/taskTestSupport';
import * as persistence from '../symptomSummaryPersistence';
import {
  apple,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';

test('selects a factual-summary contract only for the explicit summary action and keeps record reads lazy', async () => {
  const source = localData([]);
  const diseaseRunner = jest
    .fn<
      ReturnType<typeof runDiseaseHypothesisAnalysis>,
      Parameters<typeof runDiseaseHypothesisAnalysis>
    >()
    .mockResolvedValue({
      status: 'incomplete_inventory',
      reason: 'unavailable',
    });
  const services = createAiFeatureServices(consent, {
    selectedAi: {
      selectionStore: selectionStore({
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => source.data,
    diseaseRunner,
  });
  await services.summarizeSymptoms!();
  expect(diseaseRunner.mock.calls[0]?.[4]?.taskType).toBe(
    'symptom_record_summary',
  );
  expect(diseaseRunner.mock.calls[0]?.[4]?.finalResultPartition?.by).toBe(
    'source_kind',
  );
  expect(diseaseRunner.mock.calls[0]?.[0].initialEvidence?.items).toEqual([]);
  expect(source.data.readCandidates).not.toHaveBeenCalled();
  expect(source.data.loadCurrentChunks).not.toHaveBeenCalled();
  expect(
    diseaseRunner.mock.calls[0]?.[0].tools.find(
      tool => tool.id === 'local-personal-records',
    )?.inputSchema,
  ).toHaveProperty('properties.view');
  expect(
    diseaseRunner.mock.calls[0]?.[0].tools.some(
      tool => tool.sourceKind === 'external_medical',
    ),
  ).toBe(false);
  expect(
    diseaseRunner.mock.calls[0]?.[0].execution.allowedScope.sourceKinds,
  ).toContain('external_medical');
  await services.generateDiseaseHypotheses();
  expect(diseaseRunner.mock.calls[1]).toHaveLength(5);
  expect(
    diseaseRunner.mock.calls[1]?.[0].tools.find(
      tool => tool.id === 'local-personal-records',
    )?.inputSchema,
  ).not.toHaveProperty('properties.view');
});

test('routes both accepted symptom actions through the same durable save boundary', async () => {
  const result = await runMultiAgentWorkflow({
    ...workflowOptions(),
    task: diseaseHypothesisTask,
  });
  expect(result.status).toBe('result');
  const outcome = { status: 'workflow' as const, result };
  type Save = ReturnType<
    typeof persistence.createSymptomSummaryPersistence
  >['save'];
  const save = jest.fn<ReturnType<Save>, Parameters<Save>>(
    async value => value,
  );
  const factory = jest
    .spyOn(persistence, 'createSymptomSummaryPersistence')
    .mockReturnValue({
      history: { list: async () => [], read: async () => null },
      save,
    });
  try {
    const source = localData([]);
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => source.data,
      diseaseRunner: jest.fn(async () => outcome),
    });
    const summary = await services.summarizeSymptoms!();
    const analysis = await services.generateDiseaseHypotheses();
    expect(save).toHaveBeenCalledTimes(2);
    expect(summary).toBe(save.mock.calls[0]?.[0]);
    expect(analysis).toBe(save.mock.calls[1]?.[0]);
    expect(summary.status).toBe('workflow');
    if (summary.status !== 'workflow' || summary.result.status !== 'result')
      throw new Error('Expected a saved result');
    expect(summary.result.value.hypotheses[0]?.summary).toBe(
      result.status === 'result'
        ? result.value.hypotheses[0]?.summary
        : undefined,
    );
    expect(summary.result.value.hypotheses[0]?.missingData.join(' ')).toContain(
      '공개 웹검색을 사용할 수 없어',
    );
  } finally {
    factory.mockRestore();
  }
});
