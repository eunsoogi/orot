import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import type { MultiAgentWorkflowOptions } from '@orot/agent-runtime';
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

test('continues the exact persisted thread only after explicit action and atomic claim', async () => {
  const order: string[] = [];
  const paused = {
    status: 'paused',
    checkpoint: { phase: 'task_response' },
  } as never;
  const completed = { status: 'result', value: 'done' } as never;
  run.mockResolvedValueOnce(paused).mockResolvedValueOnce(completed);
  const checkpointer = {} as never;
  const continuation = {
    bindPause: jest.fn(),
    waitForContinue: async () => {
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
      paused: async () => {
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
});

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
