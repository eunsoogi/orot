import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceSearchTool,
  type MultiAgentWorkflowOptions,
} from '../src';

const reference = {
  sourceKind: 'personal_record' as const,
  sourceId: 'r1',
  sourceRevision: '1',
  evidenceId: 'e1',
  evidenceRevision: '1',
  locator: { recordId: 'r1' },
  effectiveTime: null,
  reviewState: 'reviewed' as const,
};
const batch: EvidenceBatch = {
  items: [{ ...reference, content: 'Synthetic record' }],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['r1'],
      gaps: ['Synthetic source unavailable'],
      truncated: false,
      resultLimit: 5,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};

test.each([true, false])(
  'native tool result with coverage gap honors opt-in %s',
  async (optedIn) => {
    const search = jest.fn(async () => batch);
    const tool: EvidenceSearchTool = {
      id: 'local-record-search',
      sourceKind: 'personal_record',
      execution: 'local_read_only',
      description: 'Read synthetic records.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      parseInput: () => ({}),
      search,
    };
    const generate = jest
      .fn()
      .mockResolvedValueOnce(
        providerSuccess({
          text: '',
          toolCalls: [{ id: 'call-1', name: tool.id, arguments: {} }],
          finishReason: 'tool_calls' as const,
        }),
      )
      .mockResolvedValueOnce(
        providerSuccess({
          text: JSON.stringify({
            type: 'result',
            value: { summary: 'Cited observation' },
            citations: ['e1'],
          }),
          toolCalls: [],
          finishReason: 'complete' as const,
        }),
      );
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'fixture',
      displayName: 'Fixture',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: true,
      },
      generate,
    };
    const options: MultiAgentWorkflowOptions<{ summary: string }> = {
      execution: {
        operationRunId: 'native-partial',
        providerId: provider.id,
        modelId: 'fixture',
        recipient: 'fixture',
        remoteProcessing: false,
        allowedScope: { sourceKinds: ['personal_record'] },
        budget: {
          maxModelCalls: 3,
          maxToolCalls: 1,
          maxResearchCycles: 1,
          maxPayloadBytes: 32000,
          maxOutputTokens: 512,
          timeoutMs: 5000,
          maxEvidenceItems: 5,
        },
      },
      provider,
      request: 'Summarize.',
      initialEvidence: { items: [], coverage: [], conflicts: [] },
      tools: [tool],
      consent: { authorize: async () => 'authorized' },
      revalidateEvidence: async () => true,
      task: {
        taskType: 'native-partial-fixture',
        taskVersion: '1',
        systemPrompt: 'Cite the evidence.',
        resultSchema: {
          type: 'object',
          properties: { summary: { type: 'string' } },
          required: ['summary'],
        },
        requiredToolEvidenceKinds: ['personal_record'],
        ...(optedIn ? { allowPartialEvidence: true } : {}),
        createMessages: () => [{ role: 'user', content: 'Summarize.' }],
        validateResult(value) {
          return value &&
            !Array.isArray(value) &&
            typeof value === 'object' &&
            typeof value.summary === 'string'
            ? { status: 'valid', value: { summary: value.summary } }
            : { status: 'invalid', reason: 'Invalid summary' };
        },
      },
    };
    const result = await runMultiAgentWorkflow(options);
    expect(search).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(optedIn ? 'result' : 'needs_clarification');
    if (result.status === 'result') {
      expect(result.partialEvidence).toBe(true);
      expect(result.citations).toEqual([reference]);
      expect(result.coverage).toEqual(batch.coverage);
    }
  },
);
