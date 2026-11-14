import { availableEvidenceTools } from '../src/multiAgent/initialEvidenceSearch';
import { initialState } from '../src/multiAgent/workflowSupport';
import { MemorySaver } from '@langchain/langgraph/web';
import {
  createEuropePmcEvidenceSearchTool,
  createMultiAgentPauseController,
  runMultiAgentWorkflow,
  type EvidenceBatch,
} from '../src';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';
import { operationJournalFixture } from './workflow-operation-journal-fixture';

function fixture() {
  const pause = createMultiAgentPauseController();
  let evidence: EvidenceBatch = { items: [], coverage: [], conflicts: [] };
  const search = jest.fn(async () => ({
    status: 'available' as const,
    publications: [publication],
  }));
  let approvals = 0;
  const authorize = jest.fn(async (): Promise<'authorized' | 'denied'> => {
    if (++approvals === 1) pause.requestPause();
    return 'authorized' as const;
  });
  const adapter = createEuropePmcEvidenceSearchTool({
    service: { search },
    consent: { authorize },
  });
  const tool = {
    ...adapter,
    async prepareAuthorizedSearch(
      ...args: Parameters<NonNullable<typeof adapter.prepareAuthorizedSearch>>
    ) {
      const prepared = await adapter.prepareAuthorizedSearch!(...args);
      if (prepared.status !== 'authorized') return prepared;
      return {
        status: 'authorized' as const,
        async dispatch() {
          const result = await prepared.dispatch();
          if (!('status' in result)) evidence = result;
          return result;
        },
      };
    },
  };
  const provider = makeProvider([scriptedOutputs()[2]!]).provider;
  const journal = operationJournalFixture();
  const options = {
    ...workflowOptions(provider, tool),
    initialSearch: { toolId: tool.id, input: { query: 'synthetic literature' } },
    checkpointer: new MemorySaver(),
    operationJournal: journal.journal,
    restoreEvidence: async () => evidence,
  };
  return {
    options,
    pause,
    search,
    authorize,
    provider,
    config: { configurable: { thread_id: 'synthetic-initial-search' } },
  };
}

test('initial query approval pauses before any dispatch and resumes once on the same graph', async () => {
  const f = fixture();
  const first = await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause });
  expect(first).toMatchObject({
    status: 'paused',
    checkpoint: {
      initialSearchStatus: 'pending',
      awaitingAuthorization: 'tool-1',
      modelCalls: 0,
      toolCalls: 1,
    },
  });
  expect(f.search).not.toHaveBeenCalled();
  const next = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: createMultiAgentPauseController(),
  });
  expect(next.status).toBe('result');
  expect(next.checkpoint.initialSearchStatus).toBe('success');
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(f.authorize).toHaveBeenCalledTimes(2);
});

test('a late approval after Stop cannot dispatch the initial search', async () => {
  const f = fixture();
  const controller = new AbortController();
  f.authorize.mockImplementation(async () => {
    controller.abort();
    return 'authorized';
  });
  const result = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: f.pause,
    signal: controller.signal,
  });
  expect(result.status).toBe('cancelled');
  expect(f.search).not.toHaveBeenCalled();
});

test('initial search identity cannot change while its approval is paused', async () => {
  const f = fixture();
  const first = await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause });
  expect(first.status).toBe('paused');
  f.options.initialSearch.input.query = 'changed synthetic query';
  const result = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: createMultiAgentPauseController(),
  });
  expect(result.status).not.toBe('result');
  expect(f.search).not.toHaveBeenCalled();
  expect(f.authorize).toHaveBeenCalledTimes(1);
});

test('search completion remains owned while the first model approval pauses', async () => {
  const f = fixture();
  f.authorize.mockResolvedValue('authorized');
  let modelApprovals = 0;
  f.options.consent = {
    authorize: async () => {
      if (++modelApprovals === 1) f.pause.requestPause();
      return 'authorized';
    },
  };
  const first = await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause });
  expect(first).toMatchObject({ status: 'paused', checkpoint: { initialSearchStatus: 'success' } });
  const result = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: createMultiAgentPauseController(),
  });
  expect(result.status).toBe('result');
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(f.authorize).toHaveBeenCalledTimes(1);
});

test('denied and empty initial searches never reoffer an external tool', () => {
  const f = fixture();
  const state = initialState(f.options);
  expect(
    availableEvidenceTools(f.options, { ...state, initialSearchStatus: 'consent_required' }),
  ).toEqual([]);
  expect(availableEvidenceTools(f.options, { ...state, initialSearchStatus: 'empty' })).toEqual([]);
  expect(availableEvidenceTools(f.options, { ...state, initialSearchStatus: 'success' })).toEqual(
    f.options.tools,
  );
});

test('a delegated initial search reserves its model cost only once across approval pause', async () => {
  const f = fixture();
  f.options.tools = f.options.tools.map((tool) => ({ ...tool, additionalModelCalls: 1 as const }));
  const first = await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause });
  expect(first).toMatchObject({ status: 'paused', checkpoint: { modelCalls: 1, toolCalls: 1 } });
  const result = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: createMultiAgentPauseController(),
  });
  expect(result).toMatchObject({ status: 'result', checkpoint: { modelCalls: 2, toolCalls: 1 } });
  expect(f.search).toHaveBeenCalledTimes(1);
});

test('denied preflight still permits a safe local-answer approval pause without an external retry', async () => {
  const f = fixture();
  f.authorize.mockImplementation(async () => 'denied');
  let modelApprovals = 0;
  f.options.consent = {
    authorize: async () => {
      if (++modelApprovals === 1) f.pause.requestPause();
      return 'authorized';
    },
  };
  const first = await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause });
  expect(first).toMatchObject({
    status: 'paused',
    checkpoint: {
      initialSearchStatus: 'consent_required',
      selectedToolId: undefined,
    },
  });
  await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: createMultiAgentPauseController(),
  });
  expect(f.search).not.toHaveBeenCalled();
  expect(f.authorize).toHaveBeenCalledTimes(1);
  expect(modelApprovals).toBe(2);
});
