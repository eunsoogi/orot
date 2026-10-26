import { createAiFeatureServices } from '../featureServices';
import { runRagConversationTurn } from '../../../ragConversation/service';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import {
  jsonByteLength,
  MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
} from '../evidenceUtils';
import {
  apple,
  consent,
  localData,
  memoryRecord,
  selectionStore,
} from '../featureServiceFixtures';

it('keeps oversized local evidence out of disease, RAG, and tool payloads', async () => {
  const record = { ...memoryRecord(1), text: '한'.repeat(8_000) };
  const source = localData([record]);
  let diseaseOptions:
    Parameters<typeof runDiseaseHypothesisAnalysis>[0] | undefined;
  let ragToolResult:
    import('@orot/agent-runtime').EvidenceSearchOutcome | undefined;
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
      ragToolResult = await options.workflow.tools[1]!.search({
        operationRunId: 'oversize-test',
        operationKey: 'tool-1',
        input: { query: options.question },
        allowedScope: { sourceKinds: ['reviewed_memory'] },
        resultLimit: 8,
        maxPayloadBytes: 64 * 1024,
        signal,
      });
      return { status: 'insufficient' } as const;
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
  expect(initialEvidence.coverage).toEqual([]);
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
  expect('items' in toolResult && toolResult.coverage[0]?.truncated).toBe(true);

  await expect(services.sendRagMessage('기억 내용', [])).resolves.toEqual({
    status: 'insufficient',
  });
  expect(
    ragToolResult &&
      'items' in ragToolResult &&
      ragToolResult.coverage[0]?.truncated,
  ).toBe(true);
  expect(jsonByteLength(ragToolResult)).toBeLessThanOrEqual(
    MAX_FEATURE_EVIDENCE_PAYLOAD_BYTES,
  );
});
