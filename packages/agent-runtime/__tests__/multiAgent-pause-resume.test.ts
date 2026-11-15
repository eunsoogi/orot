import { MemorySaver } from '@langchain/langgraph/web';
import {
  createEuropePmcEvidenceSearchTool,
  createMultiAgentPauseController,
  isMultiAgentCheckpointResumable,
  runMultiAgentWorkflow,
} from '../src';
import type { EvidenceBatch, MultiAgentCheckpointState } from '../src';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

function fixture() {
  const pause = createMultiAgentPauseController();
  let restored: EvidenceBatch = { items: [], coverage: [], conflicts: [] };
  const service = {
    search: jest.fn(async () => ({ status: 'available' as const, publications: [publication] })),
  };
  const adapter = createEuropePmcEvidenceSearchTool({
    service,
    consent: { authorize: async () => 'authorized' },
  });
  const search = jest.fn(async (...args: Parameters<typeof adapter.search>) => {
    const result = await adapter.search(...args);
    if ('items' in result) restored = result;
    pause.requestPause();
    return result;
  });
  const { provider, generate } = makeProvider(scriptedOutputs());
  const options = {
    ...workflowOptions(provider, { ...adapter, search }),
    checkpointer: new MemorySaver(),
    restoreEvidence: jest.fn(async () => restored),
  };
  const config = { configurable: { thread_id: 'synthetic-paused-turn' } };
  return { pause, options, config, generate, search, service };
}

test('durably drains after a completed tool and resumes the same graph without replay', async () => {
  const run = fixture();
  const first = await runMultiAgentWorkflow(run.options, { config: run.config, pause: run.pause });
  expect(first.status).toBe('paused');
  expect(first.checkpoint).toMatchObject({
    phase: 'revised_response',
    pendingOperation: undefined,
    toolCalls: 1,
    terminal: false,
  });
  expect(run.generate).toHaveBeenCalledTimes(2);
  expect(run.search).toHaveBeenCalledTimes(1);
  const second = await runMultiAgentWorkflow(run.options, { config: run.config });
  expect(second.status).toBe('result');
  expect(second.checkpoint.toolCalls).toBe(1);
  expect(run.generate).toHaveBeenCalledTimes(3);
  expect(run.search).toHaveBeenCalledTimes(1);
  expect(run.service.search).toHaveBeenCalledTimes(1);
});

test('source revision invalidation blocks a paused graph before any new dispatch', async () => {
  const run = fixture();
  expect(
    (await runMultiAgentWorkflow(run.options, { config: run.config, pause: run.pause })).status,
  ).toBe('paused');
  run.options.revalidateEvidence = jest.fn(async () => false);
  const second = await runMultiAgentWorkflow(run.options, { config: run.config });
  expect(second.status).toBe('stale_evidence');
  expect(run.generate).toHaveBeenCalledTimes(2);
  expect(run.search).toHaveBeenCalledTimes(1);
});

test('an uncertain pending checkpoint is not made resumable by a pause request', async () => {
  const run = fixture();
  const saved: MultiAgentCheckpointState = {
    ...run.options.execution,
    phase: 'revised_response',
    modelCalls: 2,
    toolCalls: 1,
    researchCycles: 1,
    evidenceReferences: [],
    terminal: false,
    pendingOperation: { kind: 'tool', operationKey: 'uncertain-side-effect' },
  };
  run.pause.requestPause();
  const result = await runMultiAgentWorkflow(run.options, {
    config: run.config,
    pause: run.pause,
    resumeFrom: saved,
  });
  expect(result.status).toBe('stale_evidence');
  expect(isMultiAgentCheckpointResumable(saved, run.options)).toBe(false);
  expect(isMultiAgentCheckpointResumable(null, run.options)).toBe(false);
  expect(run.generate).not.toHaveBeenCalled();
  expect(run.search).not.toHaveBeenCalled();
});

test('a pause requested before execution persists a safe initial boundary without dispatch', async () => {
  const run = fixture();
  run.pause.requestPause();
  const first = await runMultiAgentWorkflow(run.options, { config: run.config, pause: run.pause });
  expect(first.status).toBe('paused');
  expect(first.checkpoint).toMatchObject({
    phase: 'task_response',
    modelCalls: 0,
    pendingOperation: undefined,
  });
  expect(run.generate).not.toHaveBeenCalled();
  expect(run.search).not.toHaveBeenCalled();
  // Use a new run-scoped controller. The completed search requests the old controller only.
  const result = await runMultiAgentWorkflow(run.options, {
    config: run.config,
    pause: createMultiAgentPauseController(),
  });
  expect(result.status).toBe('result');
  expect(run.search).toHaveBeenCalledTimes(1);
});

test('hard cancellation is not reported as a successful cooperative pause', async () => {
  const run = fixture();
  const abort = new AbortController();
  run.pause.requestPause();
  abort.abort();
  const result = await runMultiAgentWorkflow(run.options, {
    config: run.config,
    pause: run.pause,
    signal: abort.signal,
  });
  expect(result.status).toBe('cancelled');
  expect(result.checkpoint.terminal).toBe(true);
  expect(run.generate).not.toHaveBeenCalled();
  expect(run.search).not.toHaveBeenCalled();
});

test('a resumed attempt already asked to pause does not dispatch its next model', async () => {
  const run = fixture();
  expect(
    (await runMultiAgentWorkflow(run.options, { config: run.config, pause: run.pause })).status,
  ).toBe('paused');
  const pause = createMultiAgentPauseController();
  pause.requestPause();
  const result = await runMultiAgentWorkflow(run.options, { config: run.config, pause });
  expect(result.status).toBe('paused');
  expect(run.generate).toHaveBeenCalledTimes(2);
  expect(run.search).toHaveBeenCalledTimes(1);
});
