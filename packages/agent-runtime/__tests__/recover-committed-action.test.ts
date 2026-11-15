import { recoverCommittedAction } from '../src/multiAgent/recoverCommittedAction';
import { DEFAULT_MULTI_AGENT_BUDGET, type MultiAgentWorkflowOptions } from '../src';
import { initialState } from '../src/multiAgent/workflowSupport';
import { reference } from './multiAgent-external-evidence-fixtures';
import { referencesFromBatch } from '../src/multiAgent/evidence';

function fixture() {
  const batch = {
    items: [
      { ...reference, sourceKind: 'personal_record' as const, content: 'Synthetic', locator: {} },
    ],
    coverage: [],
    conflicts: [],
  };
  const refs = referencesFromBatch(batch);
  const execute = jest.fn();
  const recover = jest.fn(async () => refs);
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
      { id: 'save', version: '1', parseInput: (v: unknown) => v, authorize, execute, recover },
    ],
    operationJournal: { loadPrepared },
    revalidateEvidence: jest.fn(async () => true),
  } as unknown as MultiAgentWorkflowOptions<unknown>;
  const state = {
    ...initialState(options),
    committedAction: true,
    toolCalls: 1,
    evidenceReferences: refs,
    committedActionReceipts: [
      {
        version: 1 as const,
        operationRunId: 'run',
        operationKey: 'tool-1',
        toolId: 'save',
        toolVersion: '1',
        evidenceReferences: refs,
      },
    ],
  };
  return { options, state, context, execute, recover, authorize };
}

test('exact protected input and committed receipt recover without dispatch', async () => {
  const f = fixture();
  expect(await recoverCommittedAction(f.state, f.options, new AbortController().signal)).toBe(true);
  expect(f.authorize).toHaveBeenCalledTimes(1);
  expect(f.recover).toHaveBeenCalledTimes(1);
  expect(f.execute).not.toHaveBeenCalled();
});

test.each(['run', 'call', 'source', 'denied', 'pending'] as const)(
  'fails closed without dispatch: %s',
  async (mode) => {
    const f = fixture();
    if (mode === 'run') f.context.binding.execution.operationRunId = 'different';
    if (mode === 'call') f.context.binding.toolCalls = 2;
    if (mode === 'source') f.state.evidenceReferences = [];
    if (mode === 'denied') f.authorize.mockResolvedValue(false);
    if (mode === 'pending') f.state.pendingOperation = { kind: 'tool', operationKey: 'tool-1' };
    expect(await recoverCommittedAction(f.state, f.options, new AbortController().signal)).toBe(
      false,
    );
    expect(f.execute).not.toHaveBeenCalled();
    expect(f.recover).not.toHaveBeenCalled();
  },
);

test('all committed receipts must verify; duplicate operation identities are rejected', async () => {
  const f = fixture();
  const first = f.state.committedActionReceipts[0]!;
  f.state.toolCalls = 2;
  f.state.committedActionReceipts = [first, { ...first, operationKey: 'tool-2' }];
  f.options.operationJournal!.loadPrepared = jest.fn(async (id) => ({
    operationId: id,
    input: JSON.stringify({
      ...f.context,
      binding: {
        ...f.context.binding,
        toolCalls: id === 'tool-1:context' ? 1 : 2,
      },
    }),
    evidenceReferences: [],
  }));
  expect(await recoverCommittedAction(f.state, f.options, new AbortController().signal)).toBe(true);
  expect(f.recover).toHaveBeenCalledTimes(2);
  expect(f.execute).not.toHaveBeenCalled();
  f.state.committedActionReceipts = [first, first];
  expect(await recoverCommittedAction(f.state, f.options, new AbortController().signal)).toBe(
    false,
  );
  expect(f.recover).toHaveBeenCalledTimes(2);
});
