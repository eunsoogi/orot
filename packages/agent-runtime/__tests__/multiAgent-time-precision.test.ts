import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceReference,
  type EvidenceTimeRange,
  type MultiAgentWorkflowOptions,
  type TaskResponderContract,
} from '../src';

const range: EvidenceTimeRange = {
  fromInclusive: '2026-10-01T06:00:00.123400000Z',
  toExclusive: '2026-10-01T06:00:00.124400000Z',
};

function runAt(
  effectiveTime: string,
  coveredTimeRange?: EvidenceTimeRange,
  allowedTimeRange: EvidenceTimeRange = range,
) {
  const reference: EvidenceReference = {
    sourceKind: 'personal_record',
    sourceId: 'record-1',
    sourceRevision: 'record-revision-1',
    evidenceId: 'observation-1',
    evidenceRevision: 'evidence-revision-1',
    locator: { kind: 'structured_record', recordId: 'observation-1' },
    effectiveTime,
    unit: 'mmHg',
    reviewState: 'reviewed',
  };
  const evidence: EvidenceBatch = {
    items: [{ ...reference, content: 'Synthetic blood pressure: 120/80 mmHg.' }],
    coverage: [
      {
        sourceKind: 'personal_record',
        searchedSourceIds: ['record-1'],
        requestedTimeRange: allowedTimeRange,
        ...(coveredTimeRange ? { coveredTimeRange } : {}),
        gaps: [],
        truncated: false,
        resultLimit: 5,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  };
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
    generate: async () =>
      providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { summary: 'Ask about the recorded blood pressure.' },
          citations: [reference],
        }),
        toolCalls: [],
        finishReason: 'complete',
      }),
  };
  const task: TaskResponderContract<{ summary: string }> = {
    taskType: 'synthetic-visit-questions',
    taskVersion: '1',
    systemPrompt: 'Return a cautious, evidence-linked result.',
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
  const options: MultiAgentWorkflowOptions<{ summary: string }> = {
    execution: {
      operationRunId: 'run-time-precision',
      providerId: provider.id,
      modelId: 'model-time-precision',
      recipient: 'selected-account',
      remoteProcessing: true,
      allowedScope: {
        sourceKinds: ['personal_record'],
        sourceIds: ['record-1'],
        timeRange: allowedTimeRange,
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
    request: 'Prepare synthetic visit questions.',
    task,
    initialEvidence: evidence,
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
  return runMultiAgentWorkflow(options);
}

describe('multi-agent timestamp precision', () => {
  it('accepts a one-nanosecond half-open range and its inclusive start', async () => {
    const oneNanosecond: EvidenceTimeRange = {
      fromInclusive: '2026-10-01T06:00:00.123400000Z',
      toExclusive: '2026-10-01T06:00:00.123400001Z',
    };
    const result = await runAt(oneNanosecond.fromInclusive, undefined, oneNanosecond);

    expect(result.status).toBe('result');
  });

  it('rejects evidence one nanosecond before the inclusive start and at the exclusive end', async () => {
    const beforeStart = await runAt('2026-10-01T06:00:00.123399999Z');
    const atEnd = await runAt(range.toExclusive);

    expect(beforeStart.status).toBe('invalid_output');
    expect(atEnd.status).toBe('invalid_output');
  });

  it('accepts evidence later in the same millisecond before the exclusive end', async () => {
    const result = await runAt('2026-10-01T06:00:00.124000000Z');

    expect(result.status).toBe('result');
  });

  it('rejects covered time ranges that cross either exact requested boundary', async () => {
    const beforeStart = await runAt('2026-10-01T06:00:00.123500000Z', {
      fromInclusive: '2026-10-01T06:00:00.123399999Z',
      toExclusive: '2026-10-01T06:00:00.124400000Z',
    });
    const afterEnd = await runAt('2026-10-01T06:00:00.123500000Z', {
      fromInclusive: '2026-10-01T06:00:00.123400000Z',
      toExclusive: '2026-10-01T06:00:00.124400001Z',
    });

    expect(beforeStart.status).toBe('invalid_output');
    expect(afterEnd.status).toBe('invalid_output');
  });
});
