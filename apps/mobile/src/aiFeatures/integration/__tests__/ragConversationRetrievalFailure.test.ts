import { runRagConversationTurn } from '../../../ragConversation/service';
import { createAiFeatureServices } from '../featureServices';
import {
  apple,
  candidatesForInventory,
  completeInventory,
  consent,
  localData,
  searchFixtureEvidence,
  selectionStore,
} from '../featureServiceFixtures';

function createService(
  readCandidates: jest.Mock,
  ragRunner: typeof runRagConversationTurn,
) {
  const source = localData([]);
  Object.assign(source.data, { readCandidates });
  const selection = selectionStore({
    providerId: apple.provider.id,
    modelId: apple.modelId,
  });
  return createAiFeatureServices(consent, {
    selectedAi: {
      selectionStore: selection,
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => source.data,
    ragRunner,
  });
}

function runnerWithLocalSearch(beforeSearch?: () => void) {
  return jest.fn(
    async (options: Parameters<typeof runRagConversationTurn>[0]) => {
      beforeSearch?.();
      await searchFixtureEvidence(options.workflow.tools, 'personal_record');
      return { status: 'no_evidence' as const };
    },
  ) as unknown as typeof runRagConversationTurn;
}

test('keeps a failed local search retryable instead of reporting no evidence', async () => {
  const readCandidates = jest.fn(async () => {
    throw new Error('Private database failure.');
  });
  const ragRunner = runnerWithLocalSearch();
  const service = createService(readCandidates, ragRunner);

  await expect(
    service.sendRagMessage('혈압 기록을 알려 주세요.', []),
  ).resolves.toEqual({ status: 'failure', kind: 'retrieval_failed' });

  expect(readCandidates).toHaveBeenCalledTimes(1);
  expect(ragRunner).toHaveBeenCalledTimes(1);
});

test('keeps a successful empty local search as a no-evidence result', async () => {
  const readCandidates = jest.fn(async () =>
    candidatesForInventory(completeInventory),
  );
  const ragRunner = runnerWithLocalSearch();
  const service = createService(readCandidates, ragRunner);

  await expect(
    service.sendRagMessage('혈압 기록을 알려 주세요.', []),
  ).resolves.toEqual({ status: 'no_evidence' });
});

test('keeps cancellation distinct when a local search also fails', async () => {
  const controller = new AbortController();
  const readCandidates = jest.fn(async () => {
    throw new Error('Private database failure.');
  });
  const ragRunner = runnerWithLocalSearch(() => controller.abort());
  const service = createService(readCandidates, ragRunner);

  await expect(
    service.sendRagMessage('혈압 기록을 알려 주세요.', [], controller.signal),
  ).resolves.toEqual({ status: 'failure', kind: 'cancelled' });
});
