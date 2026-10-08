import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import {
  DEFAULT_MULTI_AGENT_BUDGET,
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceReference,
  type MultiAgentWorkflowOptions,
  type TaskResponderContract,
} from '../src';

const message = '진료 전에 최신 혈당 기록 날짜를 확인해 주세요.';
const reference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'record-1',
  sourceRevision: 'record-rev-1',
  evidenceId: 'glucose-1',
  evidenceRevision: 'glucose-rev-1',
  locator: { kind: 'structured_record', recordId: 'glucose-1' },
  effectiveTime: '2026-10-01T08:00:00+09:00',
  unit: 'mg/dL',
  reviewState: 'reviewed',
};
const evidence: EvidenceBatch = {
  items: [{ ...reference, content: 'Synthetic glucose result, 110 mg/dL.' }],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['record-1'],
      gaps: [],
      truncated: false,
      resultLimit: 1,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};

function clarificationTask(): TaskResponderContract<{ checked: boolean }> {
  return {
    taskType: 'synthetic-clarification',
    taskVersion: '1',
    systemPrompt: 'Return one evidence-linked result.',
    resultSchema: { type: 'object', additionalProperties: false },
    createMessages: () => [{ role: 'user', content: 'Check the synthetic result.' }],
    // This safe copy is produced by task validation, not forwarded from model output.
    validateResult: () => ({ status: 'needs_clarification', message }),
  };
}

type ClarificationResult = {
  readonly status: 'needs_clarification';
  readonly message: string;
};

function validatedResultClarificationTask(
  validateResult: TaskResponderContract<ClarificationResult>['validateResult'],
): TaskResponderContract<ClarificationResult> {
  return {
    taskType: 'synthetic-clarification-result',
    taskVersion: '1',
    systemPrompt: 'Return a validated clarification result.',
    resultSchema: { type: 'object', additionalProperties: false },
    createMessages: () => [{ role: 'user', content: 'Check the synthetic result.' }],
    validateResult,
  };
}

function responseProvider(
  value: Record<string, unknown> = { checked: true },
): LanguageModelProvider {
  return {
    kind: 'language-model',
    id: 'selected-provider',
    displayName: 'Selected provider',
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
          value,
          citations: [reference],
        }),
        toolCalls: [],
        finishReason: 'complete',
      }),
  };
}

function optionsFor(
  provider: LanguageModelProvider,
  task: TaskResponderContract<unknown>,
  initialEvidence: EvidenceBatch = evidence,
): MultiAgentWorkflowOptions {
  return {
    execution: {
      operationRunId: 'clarification-message-run',
      providerId: provider.id,
      modelId: 'selected-model',
      recipient: 'on-device',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['personal_record'] },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    },
    provider,
    request: 'Check the synthetic result.',
    task,
    initialEvidence,
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
}

describe('multi-agent clarification message', () => {
  it('preserves task validation copy in the terminal workflow result', async () => {
    const result = await runMultiAgentWorkflow(optionsFor(responseProvider(), clarificationTask()));

    expect(result).toMatchObject({ status: 'needs_clarification', message });
  });

  it.each([
    {
      name: 'conflicting evidence',
      incomplete: { ...evidence, conflicts: ['Current readings disagree.'] },
    },
    {
      name: 'a missing current measurement',
      incomplete: {
        ...evidence,
        coverage: [{ ...evidence.coverage[0]!, gaps: ['No current measurement was found.'] }],
      },
    },
  ])('preserves validated clarification copy with $name', async ({ incomplete }) => {
    const result = await runMultiAgentWorkflow(
      optionsFor(responseProvider(), clarificationTask(), incomplete),
    );

    // Missing evidence still blocks a result; only task-approved copy may escape.
    expect(result).toMatchObject({ status: 'needs_clarification', message });
  });

  it('projects clarification copy from a task-validated result while blocking its result value', async () => {
    const task = validatedResultClarificationTask(() => ({
      status: 'valid',
      value: { status: 'needs_clarification', message },
    }));
    const result = await runMultiAgentWorkflow(
      optionsFor(responseProvider(), task, {
        ...evidence,
        conflicts: ['Current readings disagree.'],
      }),
    );

    expect(result).toMatchObject({ status: 'needs_clarification', message });
    expect(result).not.toHaveProperty('value');
  });

  it('does not expose responder copy rejected by task validation', async () => {
    const unsafeMessage = '약물 용량을 늘리세요.';
    const task = validatedResultClarificationTask(() => ({
      status: 'invalid',
      reason: 'The proposed clarification was rejected.',
    }));
    const result = await runMultiAgentWorkflow(
      optionsFor(
        responseProvider({ status: 'needs_clarification', message: unsafeMessage }),
        task,
        {
          ...evidence,
          conflicts: ['Current readings disagree.'],
        },
      ),
    );

    expect(result.status).toBe('needs_clarification');
    expect(result).not.toHaveProperty('message');
    expect(JSON.stringify(result)).not.toContain(unsafeMessage);
  });
});
