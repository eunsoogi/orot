import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import {
  DEFAULT_MULTI_AGENT_BUDGET,
  runMultiAgentWorkflow,
  extractPartialJsonStringAtPath,
  type MultiAgentWorkflowOptions,
} from '../src';

const reference = {
  sourceKind: 'external_medical' as const,
  sourceId: 'europe-pmc',
  sourceRevision: 'retrieved:2026-10-18T00:00:00.000Z',
  evidenceId: 'MED:12345',
  evidenceRevision: 'updated:2025-03-15',
  locator: { recordId: '12345' },
  effectiveTime: '2025-02-10',
  reviewState: 'unknown' as const,
};

test('streams responder deltas and emits phase progress without forwarding request data', async () => {
  const responseText = JSON.stringify({
    type: 'result',
    value: { summary: 'A supported result.' },
    citations: [reference.evidenceId],
  });
  const chunks = [responseText.slice(0, 23), responseText.slice(23, 51), responseText.slice(51)];
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'streaming-fixture',
    displayName: 'Streaming fixture',
    capabilities: {
      inputTypes: ['text'],
      streaming: true,
      structuredOutput: false,
      toolCalling: false,
    },
    generate: jest.fn(async () =>
      providerSuccess({ text: responseText, toolCalls: [], finishReason: 'complete' }),
    ),
    async *stream() {
      for (const text of chunks) {
        yield providerSuccess({ type: 'text_delta', text });
      }
      yield providerSuccess({
        type: 'completed',
        response: { text: responseText, toolCalls: [], finishReason: 'complete' },
      });
    },
  };
  const evidence = {
    items: [{ ...reference, content: 'Synthetic cited evidence.' }],
    coverage: [
      {
        sourceKind: 'external_medical' as const,
        searchedSourceIds: ['europe-pmc'],
        gaps: [],
        truncated: false,
        resultLimit: 1,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  };
  const options: MultiAgentWorkflowOptions<{ summary: string }> = {
    execution: {
      operationRunId: 'stream-progress-test',
      providerId: provider.id,
      modelId: 'fixture-model',
      recipient: 'selected-account',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['external_medical'] },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    },
    provider,
    request: 'A private synthetic request.',
    task: {
      taskType: 'stream-progress-fixture',
      taskVersion: '1',
      systemPrompt: 'Use the cited synthetic evidence.',
      resultSchema: {
        type: 'object',
        required: ['summary'],
        properties: { summary: { type: 'string' } },
        additionalProperties: false,
      },
      createMessages: () => [{ role: 'user', content: 'Synthetic request.' }],
      projectStreamedText: (raw) => extractPartialJsonStringAtPath(raw, ['value', 'summary']),
      validateResult(value) {
        return typeof value === 'object' && value !== null && 'summary' in value
          ? { status: 'valid', value: value as { summary: string } }
          : { status: 'invalid', reason: 'A summary is required.' };
      },
    },
    initialEvidence: evidence,
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
  const streamEvents: unknown[] = [];
  let streamedText = '';
  const progress: unknown[] = [];

  const result = await runMultiAgentWorkflow(options, {
    onProgress: (event) => progress.push(event),
    onTaskStreamEvent: (event) => {
      streamEvents.push(event);
      if (event.type === 'text_delta') streamedText += event.text;
      else if (event.type === 'text_snapshot') streamedText = event.text;
    },
  });

  expect(result.status).toBe('result');
  expect(streamedText).toBe('A supported result.');
  expect(JSON.stringify(streamEvents)).not.toContain('"citations"');
  expect(JSON.stringify(streamEvents)).not.toContain(reference.evidenceId);
  expect(progress).toEqual([{ type: 'model_started', phase: 'task_response' }]);
  expect(JSON.stringify(progress)).not.toContain('A private synthetic request.');
});
