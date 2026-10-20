import { createAiFeatureServices } from '../featureServices';
import type { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
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
  ).toBe(true);
  expect(
    diseaseRunner.mock.calls[0]?.[0].execution.allowedScope.sourceKinds,
  ).toContain('external_medical');
  await services.generateDiseaseHypotheses();
  expect(diseaseRunner.mock.calls[1]).toHaveLength(4);
  expect(
    diseaseRunner.mock.calls[1]?.[0].tools.find(
      tool => tool.id === 'local-personal-records',
    )?.inputSchema,
  ).not.toHaveProperty('properties.view');
});
