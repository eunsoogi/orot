import { createAiFeatureServices } from '../featureServices';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import {
  apple,
  consent,
  localData,
  memoryRecord,
  selectionStore,
} from '../featureServiceFixtures';

test('starts disease and conversation workflows without selecting or indexing records', async () => {
  const source = localData([memoryRecord(1)]);
  const diseaseRunner = jest.fn(async () => ({
    status: 'incomplete_inventory' as const,
    reason: 'unavailable' as const,
  }));
  const ragRunner = jest.fn(
    async (_options: Parameters<typeof runRagConversationTurn>[0]) => ({
      status: 'insufficient' as const,
    }),
  );
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
    ragRunner,
  });
  await services.generateDiseaseHypotheses();
  await services.sendRagMessage('기록을 확인해 주세요', []);
  expect(diseaseRunner).toHaveBeenCalledTimes(1);
  expect(ragRunner).toHaveBeenCalledTimes(1);
  const localTool = ragRunner.mock.calls[0]![0].workflow.tools[0]!;
  expect(
    localTool.parseInput({
      query: 'steps sleep measurements',
      view: 'health_overview',
    }),
  ).toEqual({ query: 'steps sleep measurements', view: 'health_overview' });
  expect(source.data.readCandidates).not.toHaveBeenCalled();
  expect(source.data.loadCurrentChunks).not.toHaveBeenCalled();
  expect(source.data.loadMemoryRecords).not.toHaveBeenCalled();
  expect(source.indexedChunks).toHaveLength(0);
});
