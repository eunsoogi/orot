import type { LanguageModelProvider } from '@orot/model-runtime';
import {
  DEFAULT_MULTI_AGENT_BUDGET,
  runMultiAgentWorkflow,
  type MultiAgentWorkflowOptions,
} from '../src';
import { validBudget } from '../src/multiAgent/workflowSupport';

function options(provider: LanguageModelProvider, timeoutMs: number): MultiAgentWorkflowOptions {
  return {
    execution: {
      operationRunId: 'finite-deadline',
      providerId: provider.id,
      modelId: 'synthetic',
      recipient: 'device',
      remoteProcessing: false,
      allowedScope: { sourceKinds: ['personal_record'] },
      budget: { ...DEFAULT_MULTI_AGENT_BUDGET, timeoutMs },
    },
    provider,
    request: 'Synthetic task',
    task: {
      taskType: 'synthetic',
      taskVersion: '1',
      systemPrompt: 'Synthetic task',
      resultSchema: { type: 'string' },
      createMessages: () => [{ role: 'user', content: 'Synthetic task' }],
      validateResult: (value) => ({ status: 'valid', value }),
    },
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    tools: [],
    consent: { authorize: async () => 'authorized' },
    revalidateEvidence: async () => true,
  };
}

function stalledProvider() {
  let signal: AbortSignal | undefined;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const provider: LanguageModelProvider = {
    kind: 'language-model',
    id: 'synthetic',
    displayName: 'Synthetic',
    capabilities: {
      inputTypes: ['text'],
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate: async (_request, invocation) => {
      signal = invocation?.signal;
      markStarted();
      return new Promise(() => {});
    },
  };
  return { provider, started, signal: () => signal };
}

test('accepts an explicit 90-second deadline, rejects a larger one, and retains the 45-second default', () => {
  const { provider } = stalledProvider();
  expect(DEFAULT_MULTI_AGENT_BUDGET.timeoutMs).toBe(45_000);
  expect(validBudget(options(provider, 90_000))).toBe(true);
  expect(validBudget(options(provider, 90_001))).toBe(false);
});

test.each(['deadline', 'caller'] as const)(
  'aborts the provider at the finite %s boundary',
  async (mode) => {
    const fixture = stalledProvider();
    const input = options(fixture.provider, 90_000);
    expect(validBudget(input)).toBe(true);
    jest.useFakeTimers();
    try {
      const controller = new AbortController();
      const pending = runMultiAgentWorkflow(input, { signal: controller.signal });
      await fixture.started;
      await jest.advanceTimersByTimeAsync(89_999);
      expect(fixture.signal()?.aborted).toBe(false);
      if (mode === 'caller') controller.abort();
      else await jest.advanceTimersByTimeAsync(1);
      expect((await pending).status).toBe(mode === 'caller' ? 'cancelled' : 'budget_exceeded');
      expect(fixture.signal()?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  },
);
