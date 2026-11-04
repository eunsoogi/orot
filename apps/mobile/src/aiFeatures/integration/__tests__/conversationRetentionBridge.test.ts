import { createAiFeatureServices } from '../featureServices';
import {
  apple,
  consent,
  localData,
  memoryRecord,
  searchFixtureEvidence,
  selectionStore,
} from '../featureServiceFixtures';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import type { runRagConversationTurn } from '../../../ragConversation/service';
import type { ConversationRetentionCandidate } from '../../../ragConversation/conversationRetention';
import { isPeriodSummarySource } from '../../../diseaseHypotheses/savedSummaries';
import { healthContextFixture } from '../testSupport/healthContextPersistenceFixture';
import { SqlCipherAgentMemoryStorage } from '../../../storage/agentMemoryStorage';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { reference } from '../../../diseaseHypotheses/taskTestSupport';
import { createConversationTurnRetention } from '../../../ragConversation/conversationTurnRetention';
import { isOriginalConversationSource } from '../../../ragConversation/conversationArtifactSources';

test('a retention consumer can persist and invalidate a captured conversation through SQLite', async () => {
  const db = await healthContextFixture();
  try {
    const records = [memoryRecord(1), memoryRecord(2)];
    const memory = new SqlCipherAgentMemoryStorage(db.database);
    for (const record of records) await memory.append(record);
    const storage = createConversationArtifactStorage(db.database);
    await storage.createSession('session', await storage.currentGeneration());
    const runner = jest.fn(
      async (options: Parameters<typeof runRagConversationTurn>[0]) => {
        const found = await searchFixtureEvidence(options.workflow.tools);
        const refs = found.items.map(referenceOnly);
        options.onValidatedEvidence?.(refs);
        return {
          status: 'answer' as const,
          answer: 'Synthetic answer',
          completion: 'partial' as const,
          citations: [refs[0]!],
        };
      },
    ) as unknown as typeof runRagConversationTurn;
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => localData(records).data,
      ragRunner: runner,
    });
    let failWrite = true;
    const retention = createConversationTurnRetention({
      sessionId: 'session',
      turnId: 'turn',
      createdAt: '2026-10-05T00:00:00.000Z',
      storage: {
        append: async (...args) => {
          if (failWrite) {
            failWrite = false;
            throw new Error('synthetic write failure');
          }
          await storage.append(...args);
        },
      },
    });
    const failure = jest.fn();
    await services.sendRagMessage('기억 내용을 알려 주세요', [], undefined, {
      onRetentionCandidate: retention.save,
      onRetentionFailure: failure,
    });
    expect(failure).toHaveBeenCalledTimes(1);
    expect(retention.canRetry()).toBe(true);
    await retention.retry();
    const saved = await storage.read('turn');
    expect(saved?.status).toBe('partial');
    expect(saved?.sources).toHaveLength(2);
    expect(saved?.citations?.[0]?.evidenceId).toBe(records[0]!.id);
    expect(runner).toHaveBeenCalledTimes(1);
    await memory.tombstone(records[1]!.id);
    expect(await storage.read('turn')).toBeNull();
  } finally {
    db.close();
  }
});

test('the conversation service captures cited and uncited sources for a validated answer', async () => {
  const source = localData([memoryRecord(1), memoryRecord(2)]);
  const runner = jest.fn(
    async (options: Parameters<typeof runRagConversationTurn>[0]) => {
      const found = await searchFixtureEvidence(options.workflow.tools);
      const refs = found.items.map(referenceOnly);
      options.onValidatedEvidence?.(refs);
      return {
        status: 'answer' as const,
        answer: 'Synthetic answer',
        citations: [refs[0]!],
      };
    },
  ) as unknown as typeof runRagConversationTurn;
  const services = createAiFeatureServices(consent, {
    selectedAi: {
      selectionStore: selectionStore({
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => source.data,
    ragRunner: runner,
  });
  const save = jest.fn(
    async (
      _candidate: ConversationRetentionCandidate,
      _signal: AbortSignal,
    ) => {},
  );
  const failure = jest.fn();
  const outcome = await services.sendRagMessage(
    '기억 내용을 알려 주세요',
    [],
    undefined,
    { onRetentionCandidate: save, onRetentionFailure: failure },
  );
  expect(outcome.status).toBe('answer');
  expect(save).toHaveBeenCalledTimes(1);
  const candidate = save.mock.calls[0]?.[0];
  if (!candidate) throw new Error('Expected a retained candidate.');
  expect(candidate.sources).toHaveLength(2);
  expect(candidate.citations).toHaveLength(1);
  expect(candidate.citations[0].evidenceId).toBe('memory-private-1');
  expect(
    candidate.sources.map(item =>
      !isOriginalConversationSource(item) || isPeriodSummarySource(item)
        ? undefined
        : item.records[0]?.id,
    ),
  ).toEqual(['memory-private-1', 'memory-private-2']);
  expect(failure).not.toHaveBeenCalled();
});

test('capture and write failures remain observable without discarding the answer', async () => {
  const runner = jest.fn(
    async (options: Parameters<typeof runRagConversationTurn>[0]) => {
      options.onValidatedEvidence?.([]);
      return {
        status: 'answer' as const,
        answer: 'Synthetic answer',
        citations: [],
      };
    },
  ) as unknown as typeof runRagConversationTurn;
  const services = createAiFeatureServices(consent, {
    selectedAi: {
      selectionStore: selectionStore({
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => localData([]).data,
    ragRunner: runner,
  });
  const failure = jest.fn();
  const result = await services.sendRagMessage('합성 질문', [], undefined, {
    onRetentionCandidate: async () => {
      throw new Error('write failed');
    },
    onRetentionFailure: failure,
  });
  expect(result).toMatchObject({
    status: 'answer',
    answer: expect.stringContaining('Synthetic answer'),
  });
  expect(failure).toHaveBeenCalledTimes(1);
});

test('a citation missing from admitted inputs cannot become a retained output', async () => {
  const runner = jest.fn(
    async (options: Parameters<typeof runRagConversationTurn>[0]) => {
      options.onValidatedEvidence?.([]);
      return {
        status: 'answer' as const,
        answer: 'Synthetic answer',
        citations: [reference],
      };
    },
  ) as unknown as typeof runRagConversationTurn;
  const services = createAiFeatureServices(consent, {
    selectedAi: {
      selectionStore: selectionStore({
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => localData([]).data,
    ragRunner: runner,
  });
  const save = jest.fn(async () => {});
  const failure = jest.fn();
  const result = await services.sendRagMessage('합성 질문', [], undefined, {
    onRetentionCandidate: save,
    onRetentionFailure: failure,
  });
  expect(result.status).toBe('answer');
  expect(save).not.toHaveBeenCalled();
  expect(failure).toHaveBeenCalledTimes(1);
});

test('a committed result wins over cancellation reported while its save finishes', async () => {
  const controller = new AbortController();
  const runner = jest.fn(
    async (options: Parameters<typeof runRagConversationTurn>[0]) => {
      options.onValidatedEvidence?.([]);
      return {
        status: 'answer' as const,
        answer: 'Saved answer',
        citations: [],
      };
    },
  ) as unknown as typeof runRagConversationTurn;
  const services = createAiFeatureServices(consent, {
    selectedAi: {
      selectionStore: selectionStore({
        providerId: apple.provider.id,
        modelId: apple.modelId,
      }),
      loadAppleOption: async () => apple,
    },
    loadLocalData: async () => localData([]).data,
    ragRunner: runner,
  });
  const outcome = await services.sendRagMessage(
    '합성 질문',
    [],
    controller.signal,
    {
      onRetentionCandidate: async () => {
        controller.abort();
      },
    },
  );
  expect(outcome).toMatchObject({
    status: 'answer',
    answer: expect.stringContaining('Saved answer'),
  });
});
