import { createAiFeatureServices } from '../featureServices';
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
  const ragRunner = jest.fn(async () => ({ status: 'insufficient' as const }));
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
  expect(source.data.readCandidates).not.toHaveBeenCalled();
  expect(source.data.loadCurrentChunks).not.toHaveBeenCalled();
  expect(source.data.loadMemoryRecords).not.toHaveBeenCalled();
  expect(source.indexedChunks).toHaveLength(0);
});
