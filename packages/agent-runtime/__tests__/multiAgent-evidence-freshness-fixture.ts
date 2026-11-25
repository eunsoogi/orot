import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import type { EvidenceBatch, EvidenceReference, MultiAgentWorkflowOptions } from '../src';

export const reference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'record-1',
  sourceRevision: 'record-rev-1',
  evidenceId: 'observation-1',
  evidenceRevision: 'evidence-rev-1',
  locator: { kind: 'structured_record', recordId: 'observation-1' },
  effectiveTime: '2026-10-01T08:00:00+09:00',
  unit: 'mmHg',
  reviewState: 'reviewed',
};

const evidence: EvidenceBatch = {
  items: [{ ...reference, content: 'Synthetic blood pressure: 120/80 mmHg.' }],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['record-1'],
      gaps: [],
      truncated: false,
      resultLimit: 5,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};

/** Creates a repeatable workflow with one approved synthetic evidence source. */
export function makeOptions(
  revalidateEvidence: MultiAgentWorkflowOptions<{ summary: string }>['revalidateEvidence'],
  authorize: MultiAgentWorkflowOptions<{ summary: string }>['consent']['authorize'],
  copy?: string,
  incomplete = false,
) {
  const generate = jest.fn(async () =>
    providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: { summary: 'Ask about the recorded blood pressure.' },
        citations: [reference],
      }),
      toolCalls: [],
      finishReason: 'complete',
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
  const options: MultiAgentWorkflowOptions<{ summary: string }> = {
    execution: {
      operationRunId: 'run-freshness-1',
      providerId: provider.id,
      modelId: 'model-freshness-1',
      recipient: 'selected-account',
      remoteProcessing: true,
      allowedScope: { sourceKinds: ['personal_record'], sourceIds: ['record-1'] },
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
    request: 'Prepare synthetic visit questions.',
    task: {
      taskType: 'synthetic-visit-questions',
      taskVersion: '1',
      systemPrompt: 'Return a cautious, evidence-linked result.',
      resultSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
      createMessages: ({ request, evidence: current }) => [
        {
          role: 'user',
          content: `${request}\n${current.items.map((item) => item.content).join('\n')}`,
        },
      ],
      validateResult(value) {
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          typeof value.summary !== 'string'
        ) {
          return { status: 'invalid', reason: 'A summary is required.' };
        }
        return copy
          ? { status: 'needs_clarification', message: copy }
          : { status: 'valid', value: { summary: value.summary } };
      },
    },
    initialEvidence: {
      ...evidence,
      coverage: evidence.coverage.map((entry) => ({ ...entry, truncated: incomplete })),
    },
    tools: [],
    consent: { authorize },
    revalidateEvidence,
  };
  return { options, generate };
}
