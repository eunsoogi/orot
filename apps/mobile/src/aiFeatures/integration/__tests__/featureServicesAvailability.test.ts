import type { LocalHealthEvidenceInventory } from '../../../healthEvidence/localEvidenceRepository';
import { STORAGE_TABLES } from '@orot/storage';
import { loadLocalHealthKitAutoSyncStatus } from '../../../healthkit/autoSyncLocal';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { createAiFeatureServices } from '../featureServices';
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

const queriedKinds = Object.keys(STORAGE_TABLES) as never;

function inventory(
  values: Partial<LocalHealthEvidenceInventory>,
): LocalHealthEvidenceInventory {
  return {
    ...completeInventory,
    queriedKinds,
    ...values,
  };
}

test.each([
  {
    name: 'empty library',
    inventory: inventory({
      inventoryComplete: true,
      availableKinds: [],
      records: [],
      recordCount: 0,
    }),
    sync: null,
    expected: ['저장된', '동기화'],
  },
  {
    name: 'populated library',
    inventory: inventory({
      inventoryComplete: true,
      availableKinds: ['health_observation', 'symptom_entry'],
      records: [
        {
          kind: 'symptom_entry',
          record: {
            id: 'private-synthetic-id',
            description: 'private symptom text',
          },
        },
      ] as never,
      recordCount: 2,
    }),
    sync: {
      status: 'complete' as const,
      updatedAt: '2026-10-29T00:00:00.000Z',
    },
    expected: ['건강 측정', '증상 기록', '완료'],
  },
  {
    name: 'partially inventoried library',
    inventory: inventory({
      inventoryComplete: false,
      availableKinds: ['health_observation'],
      truncatedKinds: ['health_observation'],
    }),
    sync: null,
    expected: ['일부', '전체 범위', '확인하지 못했어요'],
  },
])(
  'answers an availability question from the local $name without provider dispatch',
  async ({ inventory: currentInventory, sync, expected }) => {
    const source = localData([]);
    const readInventory = jest.fn(async () => currentInventory);
    Object.assign(source.data.repository, { readInventory });
    Object.assign(source.data.manualHistory, {
      listEvidence: jest.fn(async () => []),
    });
    const selection = selectionStore({
      providerId: apple.provider.id,
      modelId: apple.modelId,
    });
    const ragRunner = jest.fn(async () => ({
      status: 'unavailable' as const,
    })) as unknown as typeof runRagConversationTurn;
    jest
      .mocked(loadLocalHealthKitAutoSyncStatus)
      .mockReset()
      .mockResolvedValue(sync);
    if (sync === null && currentInventory.inventoryComplete === false) {
      jest
        .mocked(loadLocalHealthKitAutoSyncStatus)
        .mockRejectedValueOnce(new Error('Private storage detail.'));
    }
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
    for (const phrase of expected) expect(outcome.answer).toContain(phrase);
    expect(outcome.answer).not.toContain('private symptom text');
    expect(outcome.answer).not.toContain('Private storage detail.');
    expect(outcome.answer).toContain('Apple Health');
    expect(outcome.answer).toContain('읽기 권한');
    expect(readInventory).toHaveBeenCalledTimes(1);
    expect(selection.load).not.toHaveBeenCalled();
    expect(ragRunner).not.toHaveBeenCalled();
  },
);

test.each([
  {
    name: 'Korean health question',
    question: '어떤 건강 문제가 있는지 알려줘',
  },
  {
    name: 'English health question',
    question:
      'What does my health data stored here say about my blood pressure?',
  },
])(
  'routes a substantive $name through the selected grounded provider',
  async ({ question }) => {
    const source = localData([]);
    const readInventory = jest.fn(async () => completeInventory);
    Object.assign(source.data.repository, { readInventory });
    const selection = selectionStore({
      providerId: apple.provider.id,
      modelId: apple.modelId,
    });
    const ragRunner = jest.fn(async () => ({
      status: 'no_evidence' as const,
    })) as unknown as typeof runRagConversationTurn;
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selection,
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => source.data,
      ragRunner,
    });

    const outcome = await services.sendRagMessage(question, []);

    expect(outcome.status).not.toBe('answer');
    expect(selection.load).toHaveBeenCalledTimes(1);
    expect(readInventory).not.toHaveBeenCalled();
    expect(ragRunner).toHaveBeenCalledTimes(1);
    expect(ragRunner).toHaveBeenCalledWith(
      expect.objectContaining({ question }),
      expect.anything(),
    );
  },
);

test('turns inventory read errors into a retryable local retrieval outcome', async () => {
  const source = localData([]);
  Object.assign(source.data.repository, {
    readInventory: jest.fn(async () => {
      throw new Error('Private storage detail.');
    }),
  });
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

  expect(outcome).toEqual({ status: 'failure', kind: 'retrieval_failed' });
  expect(JSON.stringify(outcome)).not.toContain('Private storage detail.');
  expect(selection.load).not.toHaveBeenCalled();
  expect(ragRunner).not.toHaveBeenCalled();
});
