import { AuthorizationPaused } from '../src/multiAgent/journaledModelCall';
import { createActionNodes } from '../src/multiAgent/actionNodes';
import { createMultiAgentPauseController } from '../src/multiAgent/workflowPause';
import { initialState } from '../src/multiAgent/workflowSupport';
import type { RuntimeContext } from '../src/multiAgent/runtimeContext';
import { DEFAULT_MULTI_AGENT_BUDGET, type MultiAgentWorkflowOptions } from '../src';

function fixture() {
  const pause = createMultiAgentPauseController();
  const controller = new AbortController();
  const batch = { items: [], coverage: [], conflicts: [] };
  const authorize = jest.fn(async () => true);
  const execute = jest.fn(async (_request: { signal: AbortSignal }) => batch);
  const options = {
    execution: {
      operationRunId: 'run',
      providerId: 'p',
      modelId: 'm',
      allowedScope: { sourceKinds: ['personal_record'] },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    },
    initialEvidence: batch,
    actions: [{ id: 'save', authorize, execute }],
    checkpointer: {},
    operationJournal: { loadPrepared: async () => undefined },
    revalidateEvidence: async () => true,
  } as unknown as MultiAgentWorkflowOptions<unknown>;
  const context = {
    options,
    signal: controller.signal,
    timedOut: () => false,
    pause,
    researchInput: { text: 'synthetic' },
    currentEvidence: batch,
  } as unknown as RuntimeContext<unknown>;
  const state = {
    ...initialState(options),
    selectedToolId: 'save',
    toolCalls: 1,
    pendingOperation: { kind: 'tool' as const, operationKey: 'tool-1' },
  };
  return { pause, controller, context, state, authorize, execute, batch };
}

test('drain requested after dispatch does not abort the transaction signal or repeat it', async () => {
  const f = fixture();
  f.execute.mockImplementation(async (request) => {
    expect(request.signal.aborted).toBe(false);
    f.pause.requestPause();
    await Promise.resolve();
    expect(request.signal.aborted).toBe(false);
    return f.batch;
  });
  await createActionNodes(f.context).executeAction(f.state);
  expect(f.execute).toHaveBeenCalledTimes(1);
});

test('explicit Stop during approval remains cancellation, not a resumable consent wait', async () => {
  const f = fixture();
  f.authorize.mockImplementation(async () => {
    f.controller.abort();
    return true;
  });
  const result = await createActionNodes(f.context).executeAction(f.state);
  expect(result.terminal).toBe(true);
  expect(f.context.outcome?.status).toBe('cancelled');
  expect(f.execute).not.toHaveBeenCalled();
});

test('a pause-shaped exception after dispatch is uncertain, never an approval checkpoint', async () => {
  const f = fixture();
  f.execute.mockRejectedValue(new AuthorizationPaused());
  const result = await createActionNodes(f.context).executeAction(f.state);
  expect(result.terminal).toBe(true);
  expect(f.context.outcome?.status).toBe('unavailable');
  expect(f.execute).toHaveBeenCalledTimes(1);
});

test('durable preparation runs after consent and before dispatch, and Stop fences dispatch', async () => {
  const f = fixture();
  const beforeLocalAction = jest.fn(async (state, signal) => {
    expect(f.authorize).toHaveBeenCalledTimes(1);
    expect(f.execute).not.toHaveBeenCalled();
    expect(state.pendingOperation.operationKey).toBe('tool-1');
    expect(signal.aborted).toBe(false);
    f.controller.abort();
  });
  f.context.options = { ...f.context.options, beforeLocalAction };
  await createActionNodes(f.context).executeAction(f.state);
  expect(beforeLocalAction).toHaveBeenCalledTimes(1);
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.context.outcome?.status).toBe('cancelled');
});
