import type { MultiAgentInvocation } from '@orot/agent-runtime';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { createAiFeatureServices } from '../featureServices';
import {
  apple,
  completeInventory,
  consent,
  localData,
  memoryRecord,
  selectionStore,
} from '../featureServiceFixtures';

test('forwards disease progress and projected-text observers into the workflow', async () => {
  const source = localData([memoryRecord(1)]);
  let invocation:
    Parameters<typeof runDiseaseHypothesisAnalysis>[2] | undefined;
  const diseaseRunner = jest.fn(
    async (
      _options: Parameters<typeof runDiseaseHypothesisAnalysis>[0],
      _inventory: Parameters<typeof runDiseaseHypothesisAnalysis>[1],
      current: Parameters<typeof runDiseaseHypothesisAnalysis>[2],
    ) => {
      invocation = current;
      return { status: 'incomplete_inventory', reason: 'unavailable' } as const;
    },
  ) as unknown as typeof runDiseaseHypothesisAnalysis;
  const services = createAiFeatureServices(consent, {
    selectedAi: {
      selectionStore: selectionStore({
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => ({
      ...source.data,
      loadInventory: async () => completeInventory,
    }),
    diseaseRunner,
  });
  const observer: Pick<
    MultiAgentInvocation,
    'onProgress' | 'onTaskStreamEvent'
  > = {
    onProgress: jest.fn(),
    onTaskStreamEvent: jest.fn(),
  };

  await services.generateDiseaseHypotheses(undefined, observer);

  expect(invocation?.onProgress).toBe(observer.onProgress);
  expect(invocation?.onTaskStreamEvent).toBe(observer.onTaskStreamEvent);
  expect(invocation?.signal).toBeInstanceOf(AbortSignal);
});
