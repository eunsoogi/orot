import { providerSuccess, type LanguageModelProvider } from '@orot/model-runtime';
import { MemorySaver } from '@langchain/langgraph/web';
import {
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceReference,
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

function makeOptions(
  revalidateEvidence: MultiAgentWorkflowOptions<{ summary: string }>['revalidateEvidence'],
  authorize: MultiAgentWorkflowOptions<{ summary: string }>['consent']['authorize'],
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
        return { status: 'valid', value: { summary: value.summary } };
      },
    },
    initialEvidence: evidence,
    tools: [],
    consent: { authorize },
    revalidateEvidence,
  };
  return { options, generate };
}

describe('multi-agent evidence freshness at model boundaries', () => {
  it('revalidates after consent and before dispatching evidence to the provider', async () => {
    let fresh = true;
    const revalidateEvidence = jest.fn(async () => fresh);
    const authorize = jest.fn(async () => {
      fresh = false;
      return 'authorized' as const;
    });
    const { options, generate } = makeOptions(revalidateEvidence, authorize);

    const result = await runMultiAgentWorkflow(options);

    expect(generate).not.toHaveBeenCalled();
    expect(result.status).toBe('stale_evidence');
    expect(revalidateEvidence).toHaveBeenCalledTimes(2);
  });

  it('rejects a result when its cited evidence changed during the provider call', async () => {
    let fresh = true;
    const revalidateEvidence = jest.fn(async () => fresh);
    const authorize = jest.fn(async () => 'authorized' as const);
    const { options, generate } = makeOptions(revalidateEvidence, authorize);
    generate.mockImplementation(async () => {
      fresh = false;
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { summary: 'Ask about the recorded blood pressure.' },
          citations: [reference],
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    });

    const result = await runMultiAgentWorkflow(options);

    expect(result.status).toBe('stale_evidence');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(revalidateEvidence).toHaveBeenCalledTimes(3);
  });

  it('revalidates after the final checkpoint write before publishing citations', async () => {
    let fresh = true;
    const revalidateEvidence = jest.fn(async () => fresh);
    const authorize = jest.fn(async () => 'authorized' as const);
    const { options, generate } = makeOptions(revalidateEvidence, authorize);
    const saver = new MemorySaver();
    let releaseFinalWrite!: () => void;
    const finalWriteGate = new Promise<void>((resolve) => {
      releaseFinalWrite = resolve;
    });
    let markFinalWriteStarted!: () => void;
    const finalWriteStarted = new Promise<void>((resolve) => {
      markFinalWriteStarted = resolve;
    });
    const persist = saver.put.bind(saver);
    let heldFinalWrite = false;
    jest.spyOn(saver, 'put').mockImplementation(async (...args) => {
      const [, checkpoint] = args;
      const values = checkpoint.channel_values as Record<string, unknown>;
      if (!heldFinalWrite && values.phase === 'complete' && values.terminal === true) {
        heldFinalWrite = true;
        markFinalWriteStarted();
        await finalWriteGate;
      }
      return persist(...args);
    });
    const pending = runMultiAgentWorkflow(
      { ...options, checkpointer: saver },
      { config: { configurable: { thread_id: 'freshness-final-write' } } },
    );

    await finalWriteStarted;
    fresh = false;
    releaseFinalWrite();
    const result = await pending;

    expect(result.status).toBe('stale_evidence');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(revalidateEvidence).toHaveBeenCalledTimes(4);
  });

  it('does not start evidence revalidation when consent resolves after cancellation', async () => {
    let authorizeLate!: (decision: 'authorized') => void;
    let markAuthorizationStarted!: () => void;
    const authorization = new Promise<'authorized'>((resolve) => {
      authorizeLate = resolve;
    });
    const authorizationStarted = new Promise<void>((resolve) => {
      markAuthorizationStarted = resolve;
    });
    const abortedValidation = Promise.reject(new Error('Evidence lookup was aborted.'));
    abortedValidation.catch(() => undefined);
    const revalidateEvidence = jest.fn(
      (_references: readonly EvidenceReference[], signal: AbortSignal): Promise<boolean> =>
        signal.aborted ? abortedValidation : Promise.resolve(true),
    );
    const authorize = jest.fn(() => {
      markAuthorizationStarted();
      return authorization;
    });
    const { options, generate } = makeOptions(revalidateEvidence, authorize);
    const controller = new AbortController();
    const pending = runMultiAgentWorkflow(options, { signal: controller.signal });

    await authorizationStarted;
    controller.abort();
    const result = await pending;
    authorizeLate('authorized');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.status).toBe('cancelled');
    expect(revalidateEvidence).toHaveBeenCalledTimes(1);
    expect(generate).not.toHaveBeenCalled();
  });
});
