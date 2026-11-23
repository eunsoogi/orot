import { waitFor } from '@testing-library/react-native';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import type {
  ConversationToolEvent,
  MultiAgentInvocation,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import { observeConversationProviderExecution } from '../../aiFeatures/integration/observeConversationProviderExecution';
import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import type { createConversationTurnRetention } from '../conversationTurnRetention';
import { runContinuableConversationWorkflow } from '../conversationWorkflowContinuation';

jest.mock('@orot/agent-runtime', () => ({
  ...jest.requireActual('@orot/agent-runtime'),
  runMultiAgentWorkflow: jest.fn(),
}));
const run = jest.mocked(runMultiAgentWorkflow);
const options = {
  initialEvidence: { items: [], coverage: [], conflicts: [] },
  tools: [],
} as unknown as MultiAgentWorkflowOptions<unknown>;

beforeEach(() => run.mockReset());

test.each([
  { pauseReason: 'background-paused', expected: 'background-paused' },
  { pauseReason: undefined, expected: 'decision-required' },
])(
  'persists the exact checkpoint and presents the $expected reason',
  async ({ pauseReason, expected }) => {
    const checkpoint = {
      phase: 'revised_response',
      awaitingAuthorization: 'model-2',
    };
    const order: string[] = [];
    const paused = {
      status: 'paused',
      checkpoint,
      pauseReason,
    } as never;
    const completed = { status: 'result', value: 'done' } as never;
    run.mockResolvedValueOnce(paused).mockResolvedValueOnce(completed);
    const checkpointer = {} as never;
    const continuation = {
      bindPause: jest.fn(),
      waitForContinue: async (reason?: string) => {
        expect(reason).toBe(expected);
        order.push('tap');
        return true;
      },
      persisted: {
        checkpointer,
        threadId: 'original-thread',
        initialize: async (
          _options: unknown,
          _signal: AbortSignal,
          snapshot?: () => readonly unknown[],
        ) => {
          expect(snapshot?.()).toEqual([options.initialEvidence]);
          order.push('initialize');
        },
        paused: async (saved: unknown, reason?: string) => {
          expect(saved).toBe(checkpoint);
          expect(reason).toBe(expected);
          order.push('persisted');
        },
        claim: async () => {
          order.push('claim');
        },
      },
    };
    expect(
      await runContinuableConversationWorkflow(options, {}, continuation),
    ).toBe(completed);
    expect(order).toEqual(['initialize', 'persisted', 'tap', 'claim']);
    expect(run).toHaveBeenCalledTimes(2);
    for (const [workflow, invocation] of run.mock.calls) {
      expect(workflow.checkpointer).toBe(checkpointer);
      expect(invocation?.config).toEqual({
        configurable: { thread_id: 'original-thread' },
      });
      expect(invocation?.resumeFrom).toBeUndefined();
    }
  },
);

test('a rejected claim never dispatches a resumed graph', async () => {
  run.mockResolvedValueOnce({ status: 'paused', checkpoint: {} } as never);
  await expect(
    runContinuableConversationWorkflow(
      options,
      {},
      {
        bindPause: () => {},
        waitForContinue: async () => true,
        persisted: {
          checkpointer: {} as never,
          threadId: 'original',
          initialize: async () => {},
          paused: async () => {},
          claim: async () => {
            throw new Error('Source removed');
          },
        },
      },
    ),
  ).rejects.toThrow('Source removed');
  expect(run).toHaveBeenCalledTimes(1);
});

test('ordinary graph rebinds exactly after the current durable claim and rejects the old reporter', async () => {
  const order: string[] = [];
  const reportStatus = jest.fn();
  let resume: (() => void) | undefined;
  let initialInvocation: MultiAgentInvocation | undefined;
  const lifetime = createConversationRequestLifetime({
    execution: {
      begin: jest.fn(async () => true),
      end: jest.fn(),
      work: jest.fn(),
      reportStatus,
      currentPhase: () => 'active',
      isActive: async () => true,
      protectedDataAvailable: async () => true,
      subscribe: () => () => {},
    },
    interrupt: jest.fn(),
    reportFenceFailure: jest.fn(),
    pauseState: (_id, callback) => {
      resume = callback;
    },
  });
  const controller = new AbortController();
  const turn = {
    toolMessageId: 'exact-request',
    startRequest: async () => {},
    interruptRequest: async () => {},
  } as unknown as ReturnType<typeof createConversationTurnRetention>;
  await lifetime.start(1, controller, turn, 'synthetic');
  const initial = lifetime.executionObserver(controller);
  const model = jest.fn(async (_request, modelOptions) => {
    expect(Object.getOwnPropertySymbols(modelOptions ?? {})).toEqual([]);
    return providerSuccess({
      text: 'synthetic reply',
      toolCalls: [],
      finishReason: 'complete' as const,
    });
  });
  const provider = observeConversationProviderExecution(
    { generate: model } as unknown as MultiAgentWorkflowOptions['provider'],
    initial.onProviderExecution,
  );
  const event: ConversationToolEvent = {
    version: 1,
    operationRunId: 'synthetic-run',
    callId: 'tool-new',
    toolName: 'local-records',
    order: 1,
    status: 'started',
    inputSummary: { sourceKind: 'personal_record' },
    sources: [],
  };
  run
    .mockImplementationOnce(async (workflow, invocation) => {
      initialInvocation = invocation;
      order.push('initial');
      await workflow.provider.generate({} as never, {
        signal: invocation?.signal,
      });
      return {
        status: 'paused',
        checkpoint: { phase: 'task_response' },
      } as never;
    })
    .mockImplementationOnce(async (workflow, invocation) => {
      order.push('resumed');
      initialInvocation?.onToolEvent?.({ ...event, callId: 'late-old' });
      invocation?.onToolEvent?.(event);
      workflow.onAcceptedSearch?.(event);
      invocation?.onToolEvent?.({ ...event, status: 'completed' });
      await workflow.provider.generate({} as never, {
        signal: invocation?.signal,
      });
      return { status: 'result', value: 'done' } as never;
    });
  const continuation = {
    bindPause: jest.fn(),
    waitForContinue: async () => {
      const pending = initial.onWorkflowPaused();
      await waitFor(() => expect(resume).toBeDefined());
      resume?.();
      return pending;
    },
    persisted: {
      checkpointer: {} as never,
      threadId: 'original-thread',
      initialize: async () => {},
      paused: async () => {},
      claim: async () => {
        order.push('claim');
      },
    },
  };
  try {
    await expect(
      runContinuableConversationWorkflow(
        { ...options, provider },
        { signal: controller.signal },
        continuation,
        initial.backgroundStatusForLease,
      ),
    ).resolves.toMatchObject({ status: 'result' });
    expect(order).toEqual(['initial', 'claim', 'resumed']);
    expect(model).toHaveBeenCalledTimes(2);
    expect(reportStatus.mock.calls).toEqual([
      ['exact-request:lease:1:1', 'checkpointed'],
      ['exact-request:lease:1:1', 'provider_waiting'],
      ['exact-request:lease:1:1', 'provider_finished'],
      ['exact-request:lease:1:2', 'checkpointed'],
      ['exact-request:lease:1:2', 'tool_started'],
      ['exact-request:lease:1:2', 'tool_completed'],
      ['exact-request:lease:1:2', 'provider_waiting'],
      ['exact-request:lease:1:2', 'provider_finished'],
    ]);
  } finally {
    controller.abort();
    await lifetime.settle(1, controller);
  }
});
