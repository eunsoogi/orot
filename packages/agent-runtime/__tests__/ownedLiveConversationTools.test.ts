import { fixture as localEvidenceFixture } from './langchain-evidenceTool-fixtures';
import { standardSearchFixture } from './multiAgent-standard-search-fixtures';
import { bindOwnedLiveConversationTools } from '../src/multiAgent/ownedLiveConversationTools';
import { nativeToolMessagesForRequest } from '../src/multiAgent/nativeTools';
import { createSearchNodes } from '../src/multiAgent/searchNodes';
import { createActionNodes } from '../src/multiAgent/actionNodes';
import type { LocalActionTool } from '../src/multiAgent/actionContracts';
import type { RuntimeContext } from '../src/multiAgent/runtimeContext';
import type { WorkflowState } from '../src/multiAgent/state';

const owner = {
  callId: 'owned-call',
  sessionId: 'owned-session',
  delegationId: 'owned-delegation',
  responseId: 'owned-response',
};
const call = {
  ...owner,
  challengeId: 'owned-challenge',
  toolCallId: 'owned-function-call',
  name: 'local-health-context',
  args: '{"query":"synthetic"}',
};

function fixture(granted = true, authorize = false) {
  const ordinary = standardSearchFixture(true);
  const local = localEvidenceFixture();
  const controller = new AbortController();
  const search = jest.fn(async () => local.batch);
  const read = { ...local.domain, id: call.name, search };
  const prior = { ...local.domain, id: 'local prior context' };
  const collision = { ...local.domain, id: 'orot_live_tool_1' };
  const approve = jest.fn(async () => authorize);
  const execute = jest.fn(async () => ({ items: [], coverage: [], conflicts: [] }));
  const confirmTerminal = jest.fn(async () => ({ value: { summary: 'Synthetic action receipt' } }));
  const action: LocalActionTool = {
    id: 'save-local-memory',
    version: '1',
    completion: 'host_terminal',
    description: 'Save explicitly chosen local memory',
    inputSchema: read.inputSchema,
    parseInput(value) {
      return read.parseInput(value);
    },
    authorize: approve,
    execute,
  };
  const initialOpening = jest.fn(() => 'Unrequested provisional reply.');
  const tools = [read, prior, collision, ordinary.tool];
  const execution = {
    ...ordinary.options.execution,
    allowedScope: { sourceKinds: ['personal_record'] as const },
  };
  const state: WorkflowState = {
    operationRunId: execution.operationRunId,
    providerId: execution.providerId,
    modelId: execution.modelId,
    allowedScope: execution.allowedScope,
    budget: execution.budget,
    modelCalls: 1,
    toolCalls: 0,
    researchCycles: 0,
    evidenceReferences: [],
    initialSearchStatus: 'consent_required',
    phase: 'task_response',
    terminal: false,
  };
  const context: RuntimeContext<{ summary: string }> = {
    options: {
      ...ordinary.options,
      execution,
      tools,
      actions: [action],
      confirmTerminalLocalAction: confirmTerminal,
      task: {
        ...ordinary.options.task,
        nativeToolResultMode: 'evidence_references',
        initialToolResponse: initialOpening,
        reviewInitialToolResponse: true,
      },
    },
    signal: controller.signal,
    timedOut: () => false,
    currentEvidence: ordinary.options.initialEvidence,
  };
  let currentState = state;
  let shared = granted;
  let native = true;
  const bind = () =>
    bindOwnedLiveConversationTools({
      context,
      state,
      owner,
      currentState: () => currentState,
      sharedGrantCurrent: () => shared,
      nativeChallengeCurrent: (incoming) =>
        native &&
        incoming.challengeId === call.challengeId &&
        incoming.toolCallId === call.toolCallId,
    });
  return {
    bind,
    state,
    context,
    execution,
    search,
    approve,
    execute,
    confirmTerminal,
    initialOpening,
    generate: ordinary.provider.generate,
    stop: () => controller.abort(),
    revoke: () => {
      shared = false;
    },
    replace: () => {
      currentState = { ...state };
    },
    cancelChallenge: () => {
      native = false;
    },
    replaceTool: () => {
      tools[0] = { ...read };
    },
  };
}

const batch = (calls = [call]) => ({ owner, calls });

test('same ordinary catalog and exact canonical evidence binder; read result is scoped to its call', async () => {
  const f = fixture();
  const route = f.bind()!;
  const wire = route.advertise()!;
  expect(wire.map((tool) => tool.name)).toEqual([
    call.name,
    'orot_live_tool_2',
    'orot_live_tool_1',
    'save-local-memory',
  ]);
  expect(wire[0]?.parameters).toMatchObject({ required: ['query'] });
  expect(f.search).not.toHaveBeenCalled();
  const accepted = await route.accept(batch());
  if (accepted.status !== 'selected') throw new Error('Expected owned graph handoff');
  expect(accepted.handoff).toMatchObject({
    phase: 'evidence_search',
    selectedToolId: call.name,
  });
  expect(route.advertise()).toBeUndefined();
  expect(await route.accept(batch())).toEqual({ status: 'refused' });
  const node = createSearchNodes(f.context);
  const selecting = { ...f.state, ...accepted.handoff };
  const prepared = { ...selecting, ...node.prepareSearch(selecting) };
  expect(await node.executeSearch(prepared, {})).toMatchObject({ phase: 'revised_response' });
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(nativeToolMessagesForRequest(f.context.nativeToolMessages).at(-1)).toMatchObject({
    role: 'tool',
    toolCallId: call.toolCallId,
    result: { evidenceIds: ['evidence'] },
  });
  expect(JSON.stringify(nativeToolMessagesForRequest(f.context.nativeToolMessages))).not.toContain(
    'Local observation',
  );
  expect(f.initialOpening).not.toHaveBeenCalled();
  expect(f.generate).not.toHaveBeenCalled();
});

test('alias resolves without collision or truncation and cannot be invoked by its nonwire canonical name', async () => {
  const f = fixture();
  const route = f.bind()!;
  expect(await route.accept(batch([{ ...call, name: 'local prior context' }]))).toEqual({
    status: 'refused',
  });
  expect(await route.accept(batch([{ ...call, name: 'orot_live_tool_2' }]))).toMatchObject({
    status: 'selected',
    handoff: { selectedToolId: 'local prior context' },
  });
});

test.each([false, true])(
  'protected terminal action uses the original authorize/receipt path: %s',
  async (authorize) => {
    const f = fixture(true, authorize);
    const selected = await f.bind()!.accept(batch([{ ...call, name: 'save-local-memory' }]));
    if (selected.status !== 'selected')
      throw new Error('Expected ordinary protected action selection');
    expect(f.execute).not.toHaveBeenCalled();
    const node = createActionNodes(f.context);
    const state = { ...f.state, ...selected.handoff };
    await node.executeAction({ ...state, ...node.prepareAction(state) });
    expect(f.approve).toHaveBeenCalledTimes(1);
    expect(f.execute).toHaveBeenCalledTimes(authorize ? 1 : 0);
    expect(f.confirmTerminal).toHaveBeenCalledTimes(authorize ? 1 : 0);
    expect(f.context.outcome?.status).toBe(authorize ? 'result' : 'consent_required');
    expect(
      nativeToolMessagesForRequest(f.context.nativeToolMessages).every(
        (message) => message.role !== 'tool',
      ),
    ).toBe(true);
    expect(f.generate).not.toHaveBeenCalled();
  },
);

test.each(['stop', 'replace', 'revoke', 'cancelChallenge', 'replaceTool'] as const)(
  'a previously advertised registry cannot dispatch after %s',
  (retire) => {
    const f = fixture();
    const route = f.bind()!;
    f[retire]();
    return expect(route.accept(batch())).resolves.toEqual({ status: 'refused' });
  },
);

test('no shared grant means no advertisement; malformed, foreign or multi-call batches never partially bind', async () => {
  expect(fixture(false).bind()).toBeUndefined();
  const f = fixture();
  const route = f.bind()!;
  for (const value of [
    { owner: { ...owner, responseId: 'another-response' }, calls: [call] },
    batch([{ ...call, delegationId: 'another-delegation' }]),
    batch([{ ...call, args: '[]' }]),
    batch([{ ...call, toolCallId: 'replaced-id' }]),
    batch([{ ...call, name: 'unknown-tool' }]),
    batch([call, { ...call, toolCallId: 'second-id', name: 'save-local-memory' }]),
  ]) {
    expect(await route.accept(value)).toEqual({ status: 'refused' });
  }
  expect(f.context.pendingNativeToolCallId).toBeUndefined();
  expect(f.context.nativeToolMessages).toBeUndefined();
  expect(f.search).not.toHaveBeenCalled();
  expect(f.execute).not.toHaveBeenCalled();
});

test('a challenge retired while the stock binder settles cannot leave partial graph state', async () => {
  const f = fixture();
  const route = f.bind()!;
  const pending = route.accept(batch());
  f.cancelChallenge();
  expect(await pending).toEqual({ status: 'refused' });
  expect(f.context.pendingNativeToolCallId).toBeUndefined();
  expect(f.context.nativeToolMessages).toBeUndefined();
  expect(f.context.researchInput).toBeUndefined();
  expect(f.context.outcome).toBeUndefined();
});
