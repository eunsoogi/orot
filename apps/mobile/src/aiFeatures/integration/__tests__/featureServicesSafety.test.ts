import type { ChatGPTSelectionServices } from '../../../providers/selection/chatGPTServices';
import type { AiFeatureLocalData } from '../localData';
import { createAiFeatureServices } from '../featureServices';
import { AiProviderSelectionError } from '../provider';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import {
  apple,
  completeInventory,
  candidatesForInventory,
  consent,
  localData,
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

  it('reports partial local coverage in tool results without preloading it into either workflow', async () => {
    const source = localData([]);
    const partialData: AiFeatureLocalData = {
      ...source.data,
      readCandidates: jest.fn(async () =>
        candidatesForInventory({
          ...completeInventory,
          inventoryComplete: false,
          truncatedKinds: ['health_observation'],
        }),
      ),
    };
    const batches: import('@orot/agent-runtime').EvidenceSearchOutcome[] = [];
    const readTool = async (
      tools: Parameters<typeof runDiseaseHypothesisAnalysis>[0]['tools'],
    ) => {
      batches.push(
        await tools[0]!.search({
          operationRunId: 'partial-test',
          operationKey: 'tool-1',
          input: { query: '기록' },
          allowedScope: { sourceKinds: ['personal_record'] },
          resultLimit: 8,
          maxPayloadBytes: 64 * 1024,
          signal: new AbortController().signal,
        }),
      );
    };
    const ragRunner = jest.fn(
      async (options: Parameters<typeof runRagConversationTurn>[0]) => {
        await readTool(options.workflow.tools);
        return { status: 'insufficient' as const };
      },
    );
    const diseaseRunner = jest.fn(
      async (options: Parameters<typeof runDiseaseHypothesisAnalysis>[0]) => {
        expect(options.initialEvidence.items).toEqual([]);
        await readTool(options.tools);
        return {
          status: 'incomplete_inventory' as const,
          reason: 'unavailable' as const,
        };
      },
    );
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => partialData,
      diseaseRunner,
      ragRunner: ragRunner as unknown as typeof runRagConversationTurn,
    });

    await expect(services.generateDiseaseHypotheses()).resolves.toMatchObject({
      status: 'incomplete_inventory',
    });
    await expect(services.sendRagMessage('기록 질문', [])).resolves.toEqual({
      status: 'insufficient',
    });
    expect(ragRunner).toHaveBeenCalledTimes(1);
    expect(batches).toHaveLength(2);
    for (const batch of batches) {
      if (!('items' in batch))
        throw new Error('Expected local evidence coverage.');
      expect(batch.coverage[0]?.gaps.length).toBeGreaterThan(0);
      expect(batch.coverage[0]?.truncated).toBe(true);
    }
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
});
