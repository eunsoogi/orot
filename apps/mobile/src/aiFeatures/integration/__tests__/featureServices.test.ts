import { createAiFeatureServices } from '../featureServices';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { runRagConversationTurn } from '../../../ragConversation/service';
import {
  apple,
  completeInventory,
  consent,
  localData,
  memoryRecord,
  selectionStore,
} from '../featureServiceFixtures';

describe('createAiFeatureServices local evidence integration', () => {
  it('indexes only new or changed chunks before searching each local snapshot', async () => {
    const first = memoryRecord(1);
    const second = memoryRecord(2);
    const source = localData([first, second]);
    const diseaseRunner = jest.fn(async () => ({
      status: 'incomplete_inventory' as const,
      reason: 'unavailable' as const,
    }));
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => source.data,
      diseaseRunner:
        diseaseRunner as unknown as typeof runDiseaseHypothesisAnalysis,
    });

    await services.generateDiseaseHypotheses();
    expect(source.eventOrder.slice(0, 2)).toEqual(['index', 'search']);
    expect(source.data.loadStaleArtifacts).toHaveBeenCalled();
    expect(source.indexedChunks[0]).toHaveLength(2);

    await services.generateDiseaseHypotheses();
    expect(source.indexedChunks).toHaveLength(1);

    const changed = { ...first, text: '수정된 기억 내용' };
    source.replaceMemoryRecords([changed, second, memoryRecord(3)]);
    await services.generateDiseaseHypotheses();
    expect(source.indexedChunks[1]).toHaveLength(2);
    expect(source.indexedChunks[1]?.map(chunk => chunk.text)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('수정된 기억 내용'),
        expect.stringContaining('기억 내용 3'),
      ]),
    );
  });

  it('does not index RAG data when the snapshot already requires an insufficient-data response', async () => {
    const source = localData([memoryRecord(1)]);
    const data = {
      ...source.data,
      loadInventory: jest.fn(async () => ({
        ...completeInventory,
        inventoryComplete: false,
      })),
    };
    const services = createAiFeatureServices(consent, {
      selectedAi: {
        selectionStore: selectionStore({
          providerId: apple.provider.id,
          modelId: apple.modelId,
        }),
        loadAppleOption: async () => apple,
      },
      loadLocalData: async () => data,
    });

    await expect(
      services.sendRagMessage('기억 내용 확인', []),
    ).resolves.toEqual({
      status: 'insufficient',
    });
    expect(source.indexedChunks).toHaveLength(0);
    expect(source.eventOrder).toHaveLength(0);
  });

  it('passes all persisted reviewed memories and exact local citations to the feature workflows', async () => {
    const records = [memoryRecord(1), memoryRecord(2), memoryRecord(3)];
    const source = localData(records);
    let diseaseOptions:
      Parameters<typeof runDiseaseHypothesisAnalysis>[0] | undefined;
    let diseaseIdentityResolver:
      Parameters<typeof runDiseaseHypothesisAnalysis>[3] | undefined;
    let ragOptions: Parameters<typeof runRagConversationTurn>[0] | undefined;
    const diseaseRunner = jest.fn(
      async (
        options: Parameters<typeof runDiseaseHypothesisAnalysis>[0],
        inventory: Parameters<typeof runDiseaseHypothesisAnalysis>[1],
        _invocation: Parameters<typeof runDiseaseHypothesisAnalysis>[2],
        resolveIdentity: Parameters<typeof runDiseaseHypothesisAnalysis>[3],
      ) => {
        diseaseOptions = options;
        diseaseIdentityResolver = resolveIdentity;
        expect(inventory).toBe(completeInventory);
        return {
          status: 'incomplete_inventory',
          reason: 'unavailable',
        } as const;
      },
    ) as unknown as typeof runDiseaseHypothesisAnalysis;
    const ragRunner = jest.fn(
      async (options: Parameters<typeof runRagConversationTurn>[0]) => {
        ragOptions = options;
        const signal = new AbortController().signal;
        const current = await options.loadCurrentEvidence(
          options.question,
          signal,
        );
        await options.rag.search(options.question, current.chunks, 5, {
          signal,
        });
        return { status: 'no_evidence' } as const;
      },
    ) as unknown as typeof runRagConversationTurn;
    let operation = 0;
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
      createOperationRunId: () => `test-run-${++operation}`,
    });

    await services.generateDiseaseHypotheses();
    expect(source.searchedChunks[0]).toHaveLength(records.length);
    expect(diseaseOptions?.provider).toBe(apple.provider);
    expect(diseaseOptions?.execution).toMatchObject({
      providerId: apple.provider.id,
      modelId: apple.modelId,
      remoteProcessing: false,
      operationRunId: 'test-run-1',
    });
    expect(diseaseOptions?.consent).toBe(consent);
    expect(diseaseOptions?.initialEvidence.items).toHaveLength(records.length);
    const firstItem = diseaseOptions?.initialEvidence.items[0];
    if (!firstItem) throw new Error('Expected an aliased local evidence item.');
    const reference = {
      sourceKind: firstItem.sourceKind,
      sourceId: firstItem.sourceId,
      sourceRevision: firstItem.sourceRevision,
      evidenceId: firstItem.evidenceId,
      evidenceRevision: firstItem.evidenceRevision,
      locator: firstItem.locator,
      effectiveTime: firstItem.effectiveTime,
      ...(firstItem.unit === undefined ? {} : { unit: firstItem.unit }),
      reviewState: firstItem.reviewState,
    };
    expect(services.resolveSource(reference)).toMatchObject({
      sourceKind: 'reviewed_memory',
      sourceId: records[0]?.id,
      evidenceId: records[0]?.id,
    });
    expect(diseaseIdentityResolver?.(firstItem)).toEqual(
      services.resolveSource(reference),
    );
    await expect(
      services.readSource(firstItem, new AbortController().signal),
    ).resolves.toMatchObject({
      status: 'available',
      document: {
        sourceKind: 'reviewed_memory',
        record: { id: records[0]?.id, text: records[0]?.text },
      },
    });

    await services.sendRagMessage('기억 내용 확인', []);
    expect(source.searchedChunks[1]).toHaveLength(records.length);
    expect(ragOptions?.workflow.provider).toBe(apple.provider);
    expect(ragOptions?.workflow.consent).toBe(consent);
    const current = await ragOptions?.loadCurrentEvidence(
      '기억 내용 확인',
      new AbortController().signal,
    );
    expect(current?.batch.items).toHaveLength(records.length);
    expect(current?.chunks).toHaveLength(records.length);
    const ragItem = current?.batch.items[0];
    if (!ragItem) throw new Error('Expected an aliased RAG evidence item.');
    expect(ragOptions?.resolveLocalEvidenceIdentity?.(ragItem)).toEqual(
      services.resolveSource(ragItem),
    );
    expect(current?.batch.coverage.map(item => item.resultLimit)).toEqual([
      5, 5,
    ]);

    const memoryTool = diseaseOptions?.tools.find(
      tool => tool.sourceKind === 'reviewed_memory',
    );
    if (!memoryTool)
      throw new Error('Expected the local reviewed-memory search tool.');
    const scopedResult = await memoryTool.search({
      operationRunId: 'tool-run',
      operationKey: 'reviewed-memory-query',
      input: { query: '기억 내용' },
      allowedScope: {
        sourceKinds: ['reviewed_memory'],
        sourceIds: [firstItem.sourceId],
      },
      resultLimit: 2,
      maxPayloadBytes: 64 * 1024,
      signal: new AbortController().signal,
    });
    if ('items' in scopedResult) {
      expect(scopedResult.items).toHaveLength(1);
      expect(scopedResult.items[0]?.content).not.toContain('source-private-1');
    }
    const boundedResult = await memoryTool.search({
      operationRunId: 'tool-run',
      operationKey: 'bounded-memory-query',
      input: { query: '기억 내용' },
      allowedScope: { sourceKinds: ['reviewed_memory'] },
      resultLimit: 2,
      maxPayloadBytes: 64 * 1024,
      signal: new AbortController().signal,
    });
    if ('items' in boundedResult) {
      expect(boundedResult.items).toHaveLength(2);
      expect(boundedResult.coverage[0]?.truncated).toBe(true);
    }
  });
});
