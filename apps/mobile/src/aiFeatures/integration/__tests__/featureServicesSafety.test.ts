import type { ChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import type { LocalHealthEvidenceInventory } from '../../../healthEvidence/localEvidenceRepository';
import type { AiFeatureLocalData } from '../localData';
import { createAiFeatureServices } from '../featureServices';
import { AiProviderSelectionError } from '../provider';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import {
  jsonByteLength,
  MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
} from '../evidenceUtils';
import {
  apple,
  completeInventory,
  consent,
  localData,
  memoryRecord,
  selectionStore,
} from '../featureServiceFixtures';

describe('createAiFeatureServices selection and coverage boundaries', () => {
  it('requires an explicit saved AI before opening local records', async () => {
    const loadLocalData = jest.fn(async () => {
      throw new Error('Local data must not be read without a choice.');
    });
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore(null),
        loadAppleOption: async () => apple,
      },
      loadLocalData,
    });

    await expect(services.generateDiseaseHypotheses()).rejects.toBeInstanceOf(
      AiProviderSelectionError,
    );
    expect(loadLocalData).not.toHaveBeenCalled();
  });

  it('keeps partial local coverage in the insufficient state for disease and RAG features', async () => {
    const source = localData([]);
    const partialData: AiFeatureLocalData = {
      ...source.data,
      loadInventory: jest.fn(
        async (): Promise<LocalHealthEvidenceInventory> => ({
          ...completeInventory,
          inventoryComplete: false,
          truncatedKinds: ['health_observation'],
        }),
      ),
    };
    const ragRunner = jest.fn(async () => ({ status: 'no_evidence' as const }));
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => partialData,
      ragRunner: ragRunner as unknown as typeof runRagConversationTurn,
    });

    await expect(services.generateDiseaseHypotheses()).resolves.toMatchObject({
      status: 'incomplete_inventory',
    });
    await expect(services.sendRagMessage('기록 질문', [])).resolves.toEqual({
      status: 'insufficient',
    });
    expect(ragRunner).not.toHaveBeenCalled();
  });

  it('binds remote processing and the consent port to the exact saved ChatGPT model', async () => {
    const chatGPTServices: ChatGPTSelectionServices = {
      listAccounts: jest.fn(async () => [
        {
          issuedClientID: 'account-1',
          requiresSignIn: false,
          hasDirectPlanAccess: true,
        },
      ]),
      listModels: jest.fn(async () => ({
        ok: true as const,
        value: [{ id: 'model-a', slug: 'model-a', displayName: 'Model A' }],
      })),
      signIn: jest.fn(),
      signOut: jest.fn(),
      cancelSignIn: jest.fn(),
    };
    const source = localData([]);
    let ragOptions: Parameters<typeof runRagConversationTurn>[0] | undefined;
    const ragRunner = jest.fn(
      async (options: Parameters<typeof runRagConversationTurn>[0]) => {
        ragOptions = options;
        return { status: 'no_evidence' as const };
      },
    ) as unknown as typeof runRagConversationTurn;
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: 'chatgpt-plan:account-1:model-a',
          modelId: 'model-a',
        }),
        chatGPTServices,
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => source.data,
      ragRunner,
    });

    await services.sendRagMessage('기록 질문', []);
    expect(ragOptions?.workflow.execution).toMatchObject({
      providerId: 'chatgpt-plan:account-1:model-a',
      modelId: 'model-a',
      recipient: '선택한 ChatGPT 계정',
      remoteProcessing: true,
    });
    expect(ragOptions?.workflow.consent).toBe(consent);
  });

  it('keeps oversized local evidence out of disease, RAG, and tool payloads', async () => {
    const record = { ...memoryRecord(1), text: '한'.repeat(8_000) };
    const source = localData([record]);
    let diseaseOptions:
      Parameters<typeof runDiseaseHypothesisAnalysis>[0] | undefined;
    let ragWasAborted = false;
    const diseaseRunner = jest.fn(
      async (options: Parameters<typeof runDiseaseHypothesisAnalysis>[0]) => {
        diseaseOptions = options;
        return {
          status: 'incomplete_inventory',
          reason: 'unavailable',
        } as const;
      },
    ) as unknown as typeof runDiseaseHypothesisAnalysis;
    const ragRunner = jest.fn(
      async (
        options: Parameters<typeof runRagConversationTurn>[0],
        invocation: Parameters<typeof runRagConversationTurn>[1] = {},
      ) => {
        const signal = invocation.signal ?? new AbortController().signal;
        const current = await options.loadCurrentEvidence(
          options.question,
          signal,
        );
        await options.rag.search(options.question, current.chunks, 5, {
          signal,
        });
        ragWasAborted = signal.aborted;
        return { status: 'answer', answer: '답변', citations: [] } as const;
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
      diseaseRunner,
      ragRunner,
    });

    await services.generateDiseaseHypotheses();
    const initialEvidence = diseaseOptions?.initialEvidence;
    expect(initialEvidence).toBeDefined();
    if (!initialEvidence)
      throw new Error('Expected the disease workflow evidence batch.');
    expect(initialEvidence.items).toHaveLength(0);
    expect(initialEvidence.coverage.some(coverage => coverage.truncated)).toBe(
      true,
    );
    expect(jsonByteLength(initialEvidence)).toBeLessThanOrEqual(
      MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
    );

    const memoryTool = diseaseOptions?.tools.find(
      tool => tool.sourceKind === 'reviewed_memory',
    );
    if (!memoryTool)
      throw new Error('Expected the local reviewed-memory search.');
    const toolResult = await memoryTool.search({
      operationRunId: 'tool-run',
      operationKey: 'oversized-memory-query',
      input: { query: '기억 내용' },
      allowedScope: { sourceKinds: ['reviewed_memory'] },
      resultLimit: 8,
      maxPayloadBytes: 64 * 1024,
      signal: new AbortController().signal,
    });
    expect(jsonByteLength(toolResult)).toBeLessThanOrEqual(
      MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
    );
    expect('items' in toolResult && toolResult.coverage[0]?.truncated).toBe(
      true,
    );

    await expect(services.sendRagMessage('기억 내용', [])).resolves.toEqual({
      status: 'insufficient',
    });
    expect(ragWasAborted).toBe(true);
  });
});
