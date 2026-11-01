import { runRagConversationTurn } from '../../../ragConversation/service';
import { createAiFeatureServices } from '../featureServices';
import { loadLocalHealthKitAutoSyncStatus } from '../../../healthkit/autoSyncLocal';
import {
  apple,
  completeInventory,
  consent,
  localData,
  selectionStore,
} from '../featureServiceFixtures';

jest.mock('../../../healthkit/autoSyncLocal', () => ({
  loadLocalHealthKitAutoSyncStatus: jest.fn(),
}));

test('reports saved manual history when the structured inventory is empty', async () => {
  const source = localData([]);
  Object.assign(source.data.repository, {
    readInventory: jest.fn(async () => completeInventory),
  });
  const listEvidence = jest.fn(async () => [
    { sourceEntryId: 'private-entry-id' } as never,
  ]);
  Object.assign(source.data.manualHistory, { listEvidence });
  jest
    .mocked(loadLocalHealthKitAutoSyncStatus)
    .mockReset()
    .mockResolvedValue(null);

  const selection = selectionStore({
    providerId: apple.provider.id,
    modelId: apple.modelId,
  });
  const ragRunner = jest.fn() as unknown as typeof runRagConversationTurn;
  const services = createAiFeatureServices(consent, {
    selectedAi: {
      selectionStore: selection,
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => source.data,
    ragRunner,
  });

  const outcome = await services.sendRagMessage(
    'What health records can you see in the app?',
    [],
  );

  expect(outcome.status).toBe('answer');
  if (outcome.status !== 'answer')
    throw new Error('Expected a local availability answer.');
  expect(outcome.answer).toContain('수기로 작성한 건강 이력');
  expect(outcome.answer).not.toContain('private-entry-id');
  expect(listEvidence).toHaveBeenCalledWith({ limit: 1 });
  expect(selection.load).not.toHaveBeenCalled();
  expect(ragRunner).not.toHaveBeenCalled();
});
