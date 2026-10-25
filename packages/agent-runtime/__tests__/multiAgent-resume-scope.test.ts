import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  type AllowedEvidenceScope,
  type EvidenceBatch,
  type EvidenceReference,
  type MultiAgentCheckpointState,
  type MultiAgentWorkflowOptions,
} from '../src';

const reference: EvidenceReference = {
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

const restoredEvidence: EvidenceBatch = {
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

const baseBudget = {
  maxModelCalls: 3,
  maxToolCalls: 1,
  maxResearchCycles: 1,
  maxPayloadBytes: 32_000,
  maxOutputTokens: 512,
  timeoutMs: 5_000,
  maxEvidenceItems: 5,
};

function makeRun(scope: AllowedEvidenceScope, savedReference: EvidenceReference) {
  const generate = jest.fn(async () =>
    providerSuccess({
      text: JSON.stringify({
        type: 'result',
        value: { summary: 'Prepared.' },
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
      operationRunId: 'run-resume-scope-1',
      providerId: provider.id,
      modelId: 'model-1',
      recipient: 'selected-account',
      remoteProcessing: true,
      allowedScope: scope,
      budget: baseBudget,
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
      createMessages: () => [{ role: 'user', content: 'Prepare the requested questions.' }],
      validateResult: () => ({ status: 'valid', value: { summary: 'Prepared.' } }),
    },
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: jest.fn(async () => true),
    restoreEvidence: jest.fn(async () => restoredEvidence),
  };
  const resumeFrom: MultiAgentCheckpointState = {
    operationRunId: options.execution.operationRunId,
    providerId: options.execution.providerId,
    modelId: options.execution.modelId,
    allowedScope: options.execution.allowedScope,
    budget: options.execution.budget,
    phase: 'revised_response',
    modelCalls: 2,
    toolCalls: 1,
    researchCycles: 1,
    evidenceReferences: [savedReference],
    terminal: false,
  };
  return { options, generate, resumeFrom };
}

describe('multi-agent resume evidence scope', () => {
  it.each([
    {
      name: 'source identifier outside the saved scope',
      scope: { sourceKinds: ['personal_record'], sourceIds: ['record-1'] },
      savedReference: { ...reference, sourceId: 'record-2' },
    },
    {
      name: 'effective time outside the saved range',
      scope: {
        sourceKinds: ['personal_record'],
        timeRange: {
          fromInclusive: '2026-10-02T00:00:00+09:00',
          toExclusive: '2026-10-03T00:00:00+09:00',
        },
      },
      savedReference: reference,
    },
  ])('rejects $name before evidence callbacks run', async ({ scope, savedReference }) => {
    const { options, generate, resumeFrom } = makeRun(scope, savedReference);

    const result = await runMultiAgentWorkflow(options, { resumeFrom });

    expect(result.status).toBe('stale_evidence');
    // An out-of-scope reference must not reach source callbacks at all.
    expect(options.revalidateEvidence).not.toHaveBeenCalled();
    expect(options.restoreEvidence).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});
