import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import {
  createLocalObservationEvidenceTool,
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type LocalRecordQueryService,
  type TaskResponderContract,
} from '../src';

const emptyEvidence: EvidenceBatch = { items: [], coverage: [], conflicts: [] };

describe('multi-agent tool input validation', () => {
  it('rejects model-authored record filters before dispatching an observation query', async () => {
    const outputs = [
      JSON.stringify({ type: 'request_evidence', need: 'missing_coverage' }),
      JSON.stringify({
        toolId: 'selected-blood-pressure',
        sourceKind: 'personal_record',
        input: { recordIds: ['record-1'] },
      }),
    ];
    const generate = jest.fn(async () =>
      providerSuccess({
        text: outputs.shift() ?? '{}',
        toolCalls: [],
        finishReason: 'complete' as const,
      }),
    );
    const provider: LanguageModelProvider = {
      kind: 'language-model',
      id: 'selected-model',
      displayName: 'Selected model',
      capabilities: {
        inputTypes: ['text'],
        streaming: false,
        structuredOutput: false,
        toolCalling: false,
      },
      generate,
    };
    const queryHealthObservations = jest.fn();
    const service = {
      queryHealthObservations,
    } as unknown as LocalRecordQueryService<
      { readonly id: string },
      unknown,
      unknown,
      unknown,
      unknown
    >;
    const tool = createLocalObservationEvidenceTool({
      id: 'selected-blood-pressure',
      description: 'Read blood pressure observations within the selected time window.',
      queryType: 'blood_pressure',
      service,
      mapEvidence: (record) => ({
        sourceKind: 'personal_record',
        sourceId: 'record-1',
        sourceRevision: 'record-revision-1',
        evidenceId: record.id,
        evidenceRevision: 'evidence-revision-1',
        locator: { kind: 'structured_record', recordId: record.id },
        effectiveTime: '2026-10-01T08:00:00Z',
        unit: 'mmHg',
        reviewState: 'unreviewed',
        content: 'Synthetic record.',
      }),
    });
    const task: TaskResponderContract<{ summary: string }> = {
      taskType: 'synthetic-visit-questions',
      taskVersion: '1',
      systemPrompt: 'Return a cited, cautious result.',
      resultSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
      createMessages: ({ request }) => [{ role: 'user', content: request }],
      validateResult(value) {
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          typeof value.summary !== 'string'
        ) {
          return { status: 'invalid', reason: 'A summary is required.' };
        }
        return { status: 'valid', value: { summary: value.summary } };
      },
    };

    const result = await runMultiAgentWorkflow({
      execution: {
        operationRunId: 'run-invalid-tool-input',
        providerId: provider.id,
        modelId: provider.id,
        recipient: 'selected-account',
        remoteProcessing: true,
        allowedScope: {
          sourceKinds: ['personal_record'],
          timeRange: {
            fromInclusive: '2026-10-01T00:00:00Z',
            toExclusive: '2026-10-02T00:00:00Z',
          },
        },
        budget: {
          maxModelCalls: 3,
          maxToolCalls: 1,
          maxResearchCycles: 1,
          maxPayloadBytes: 32_000,
          maxOutputTokens: 512,
          timeoutMs: 5_000,
          maxEvidenceItems: 5,
        },
      },
      provider,
      request: 'Prepare evidence-linked visit questions.',
      task,
      initialEvidence: emptyEvidence,
      tools: [tool],
      consent: { authorize: async () => 'authorized' },
      revalidateEvidence: async () => true,
    });

    expect(result.status).toBe('invalid_output');
    expect(generate).toHaveBeenCalledTimes(2);
    expect(queryHealthObservations).not.toHaveBeenCalled();
    expect(JSON.stringify(result.checkpoint)).not.toContain('recordIds');
  });
});
