import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import {
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceReference,
  type MultiAgentCheckpointState,
  type MultiAgentWorkflowOptions,
} from '../src';

// A pre-aborted invocation must not start callbacks that may read local or external evidence.
const reference: EvidenceReference = {
  sourceKind: 'personal_record',
  sourceId: 'record-1',
  sourceRevision: 'source-revision-1',
  evidenceId: 'evidence-1',
  evidenceRevision: 'evidence-revision-1',
  locator: { kind: 'structured_record', recordId: 'evidence-1' },
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
      resultLimit: 1,
      returnedCount: 1,
    },
  ],
  conflicts: [],
};

function makeRun() {
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
    generate: jest.fn(async () =>
      providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { summary: 'Prepared.' },
          citations: [reference],
        }),
        toolCalls: [],
        finishReason: 'complete',
      }),
    ),
  };
  const revalidateEvidence = jest.fn(async () => true);
  const restoreEvidence = jest.fn(async () => evidence);
  const options: MultiAgentWorkflowOptions<{ summary: string }> = {
    execution: {
      operationRunId: 'run-pre-aborted-evidence-1',
      providerId: provider.id,
      modelId: 'model-pre-aborted-evidence-1',
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
      createMessages: () => [{ role: 'user', content: 'Prepare the requested questions.' }],
      validateResult: () => ({ status: 'valid', value: { summary: 'Prepared.' } }),
    },
    initialEvidence: evidence,
    restoreEvidence,
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence,
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
    evidenceReferences: [reference],
    pendingOperation: undefined,
    terminal: false,
  };
  return { options, provider, revalidateEvidence, restoreEvidence, resumeFrom };
}

describe('multi-agent evidence callbacks after cancellation', () => {
  it('does not revalidate initial evidence when the invocation signal is already aborted', async () => {
    const { options, provider, revalidateEvidence } = makeRun();
    const controller = new AbortController();
    controller.abort();

    const result = await runMultiAgentWorkflow(options, { signal: controller.signal });

    expect(result.status).toBe('cancelled');
    expect(revalidateEvidence).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('does not revalidate or restore checkpoint evidence when resume starts aborted', async () => {
    const { options, provider, revalidateEvidence, restoreEvidence, resumeFrom } = makeRun();
    const controller = new AbortController();
    controller.abort();

    const result = await runMultiAgentWorkflow(options, {
      resumeFrom,
      signal: controller.signal,
    });

    expect(result.status).toBe('cancelled');
    expect(revalidateEvidence).not.toHaveBeenCalled();
    expect(restoreEvidence).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it('does not start evidence restoration when cancellation arrives after revalidation', async () => {
    const { options, provider, restoreEvidence, resumeFrom } = makeRun();
    const controller = new AbortController();
    let resolveFreshness!: (isCurrent: boolean) => void;
    let markRevalidationStarted!: () => void;
    const revalidationStarted = new Promise<void>((resolve) => {
      markRevalidationStarted = resolve;
    });
    const revalidateEvidence = jest.fn(
      (_references: readonly EvidenceReference[], _signal: AbortSignal) =>
        new Promise<boolean>((resolve) => {
          resolveFreshness = resolve;
          markRevalidationStarted();
        }),
    );
    const pending = runMultiAgentWorkflow(
      { ...options, revalidateEvidence },
      { resumeFrom, signal: controller.signal },
    );

    await revalidationStarted;
    resolveFreshness(true);
    // Abort after the freshness observer settles but before resume restoration resumes.
    queueMicrotask(() => controller.abort());
    const result = await pending;

    expect(result.status).toBe('cancelled');
    expect(restoreEvidence).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });
});
