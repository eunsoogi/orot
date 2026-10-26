import { providerSuccess, type JsonValue, type LanguageModelProvider } from '@orot/model-runtime';
import { DEFAULT_MULTI_AGENT_BUDGET, type MultiAgentWorkflowOptions } from '../src';

/** Synthetic records exercise the complete graph without sharing personal data or calling a real provider. */
export function partitionFixture() {
  const requests: Parameters<LanguageModelProvider['generate']>[0][] = [];
  const records = (['personal_record', 'external_medical'] as const).map((sourceKind, index) => ({
    sourceKind,
    sourceId: 'source-' + index,
    sourceRevision: '1',
    evidenceId: 'evidence-' + index,
    evidenceRevision: '1',
    effectiveTime: null,
    locator: { recordId: 'record-' + index },
    reviewState: 'reviewed' as const,
    content: ('Synthetic complete facts ' + index + ' ').repeat(100),
  }));
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'bounded-context-fixture',
    displayName: 'Synthetic',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: true,
      toolCalling: false,
    },
    generate: jest.fn(async (request) => {
      requests.push(request);
      const input = JSON.parse(
        request.messages.find((message) => message.role === 'user')!.content as string,
      );
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { sections: input.records.map((item: { evidenceId: string }) => item.evidenceId) },
          citations: input.records.map((item: { evidenceId: string }) => item.evidenceId),
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    }),
  };
  const validateResult = jest.fn((value: JsonValue) => ({ status: 'valid' as const, value }));
  const mergeValues = jest.fn((values: readonly JsonValue[]) => ({
    sections: values.flatMap((value) => (value as { sections: JsonValue[] }).sections),
  }));
  const options: MultiAgentWorkflowOptions = {
    execution: {
      operationRunId: 'partitioned-result-run',
      providerId: provider.id,
      modelId: 'synthetic',
      recipient: 'device',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['personal_record', 'external_medical'] },
      budget: { ...DEFAULT_MULTI_AGENT_BUDGET, timeoutMs: 5000 },
    },
    provider,
    request: 'Summarize every supplied source.',
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: jest.fn(async () => true),
    initialEvidence: {
      items: records,
      coverage: records.map((item) => ({
        sourceKind: item.sourceKind,
        searchedSourceIds: [item.sourceId],
        gaps: [],
        truncated: false,
        resultLimit: 1,
        returnedCount: 1,
      })),
      conflicts: [],
    },
    task: {
      taskType: 'synthetic_sections',
      taskVersion: '1',
      systemPrompt: 'Summarize the supplied facts.',
      resultSchema: {
        type: 'object',
        properties: { sections: { type: 'array', items: { type: 'string' } } },
      },
      createMessages: (input) => [
        { role: 'user', content: JSON.stringify({ records: input.evidence.items }) },
      ],
      projectStreamedText: (raw) => (JSON.parse(raw).value.sections as string[]).join('\n'),
      finalResultPartition: { by: 'source_kind', mergeValues },
      validateResult,
    },
  };
  return { options, requests, records, validateResult, mergeValues };
}
