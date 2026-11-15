import {
  preparePendingActionRecovery,
  isVerifiedPendingActionRecovery,
} from '../src/multiAgent/pendingActionRecoveryOptions';
import { recoverPendingAction } from '../src/multiAgent/recoverPendingAction';
import { DEFAULT_MULTI_AGENT_BUDGET, type MultiAgentWorkflowOptions } from '../src';
import { initialState } from '../src/multiAgent/workflowSupport';
import { reference } from './multiAgent-external-evidence-fixtures';

function fixture() {
  const batch = {
    items: [
      { ...reference, sourceKind: 'personal_record' as const, content: 'Synthetic', locator: {} },
    ],
    coverage: [],
    conflicts: [],
  };
  const execute = jest.fn();
  const recover = jest.fn(async () => batch);
  const authorize = jest.fn(async () => true);
  const execution = {
    operationRunId: 'run',
    providerId: 'p',
    modelId: 'm',
    allowedScope: { sourceKinds: ['personal_record'] },
    budget: DEFAULT_MULTI_AGENT_BUDGET,
  };
  const context = {
    binding: {
      execution,
      phase: 'local_action',
      selectedToolId: 'save',
      toolCalls: 1,
      evidenceReferences: [],
    },
    researchInput: { text: 'Synthetic' },
  };
  const loadPrepared = jest.fn(async () => ({
    operationId: 'tool-1:context',
    input: JSON.stringify(context),
    evidenceReferences: [],
  }));
  const options = {
    execution,
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    actions: [
      {
        id: 'save',
        version: '1',
        parseInput: (v: unknown) => v,
        authorize,
        execute,
        recoverResult: recover,
      },
    ],
    operationJournal: { loadPrepared },
    revalidateEvidence: jest.fn(async () => true),
  } as unknown as MultiAgentWorkflowOptions<unknown>;
  const state = {
    ...initialState(options),
    phase: 'local_action' as const,
    selectedToolId: 'save',
    pendingOperation: { kind: 'tool' as const, operationKey: 'tool-1' },
    toolCalls: 1,
    evidenceReferences: [],
  };
  Object.assign(context.binding, {
    initialSearchStatus: state.initialSearchStatus,
    modelCalls: state.modelCalls,
    researchCycles: state.researchCycles,
  });
  return { options, state, context, execute, recover, authorize };
}

test('reconstructs an exact committed pending result without executing', async () => {
  const f = fixture();
  const result = await recoverPendingAction(f.state, f.options, new AbortController().signal);
  expect(result?.items).toHaveLength(1);
  expect(f.authorize).toHaveBeenCalledTimes(1);
  expect(f.recover).toHaveBeenCalledTimes(1);
  expect(f.execute).not.toHaveBeenCalled();
});

test.each(['owner', 'ordinal', 'denied', 'missing', 'deleted', 'aborted'] as const)(
  'never dispatches when pending reconciliation is unavailable: %s',
  async (mode) => {
    const f = fixture();
    const controller = new AbortController();
    if (mode === 'owner') f.state.operationRunId = 'other';
    if (mode === 'ordinal') f.state.pendingOperation.operationKey = 'tool-2';
    if (mode === 'denied') f.authorize.mockResolvedValue(false);
    if (mode === 'missing') f.recover.mockResolvedValue(undefined as never);
    if (mode === 'deleted') (f.options.revalidateEvidence as jest.Mock).mockResolvedValue(false);
    if (mode === 'aborted') controller.abort();
    expect(await recoverPendingAction(f.state, f.options, controller.signal)).toBeUndefined();
    expect(f.execute).not.toHaveBeenCalled();
  },
);

test('verified capability is exact-state bound, unforgeable by spread, and single-use read-only', async () => {
  const f = fixture();
  const signal = new AbortController().signal;
  const options = await preparePendingActionRecovery(f.state, f.options, signal);
  expect(options).toBeDefined();
  expect(isVerifiedPendingActionRecovery(options!, f.state)).toBe(true);
  expect(isVerifiedPendingActionRecovery({ ...options }, f.state)).toBe(false);
  expect(isVerifiedPendingActionRecovery(options!, { ...f.state, toolCalls: 2 })).toBe(false);
  const action = options!.actions![0]!;
  const request = {
    input: { text: 'Synthetic' },
    signal,
    operationRunId: 'run',
    operationKey: 'tool-1',
  };
  expect(await action.authorize(request.input, signal)).toBe(true);
  expect((await action.execute(request)).items).toHaveLength(1);
  await expect(action.execute(request)).rejects.toThrow('no longer current');
  expect(f.execute).not.toHaveBeenCalled();
  expect(f.authorize).toHaveBeenCalledTimes(1);
});
