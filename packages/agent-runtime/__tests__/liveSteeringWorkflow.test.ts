import { providerSuccess, type LanguageModelExecutionOptions } from '@orot/model-runtime';
import {
  createEuropePmcEvidenceSearchTool,
  runMultiAgentWorkflow,
  type WorkflowSteeringStore,
} from '../src';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';
import { operationJournalFixture } from './workflow-operation-journal-fixture';

test('real workflow delivers steering before the active provider response completes without another client call', async () => {
  const { provider, generate } = makeProvider([]);
  let rows: Awaited<ReturnType<WorkflowSteeringStore['list']>> = [];
  let listener: (() => Promise<void>) | undefined;
  let received = '';
  let finished = false;
  const steering: WorkflowSteeringStore = {
    subscribe: (callback) => {
      listener = callback;
      return () => {
        listener = undefined;
      };
    },
    enqueue: async (id, text) => {
      rows = [{ id, text, status: 'queued', sequence: 1 }];
      await listener?.();
      return true;
    },
    list: async () => rows,
    bind: async (_id, request) => request,
    acknowledge: async () => true,
    beginLive: async () => {
      rows = rows.map((row) => ({ ...row, status: 'delivery_pending' }));
      return true;
    },
    settleLive: async (_op, _id, status) => {
      if (status === 'applied') rows = rows.map((row) => ({ ...row, status: 'applied' }));
      return true;
    },
  };
  generate.mockImplementation(async (_request, execution) => {
    const live = (execution as LanguageModelExecutionOptions).midTurnSteering!;
    expect(live).toBeDefined();
    let resolve!: () => void;
    const supplied = new Promise<void>((done) => {
      resolve = done;
    });
    live.onReady({
      submit: async (id, text) => {
        expect(finished).toBe(false);
        received = text;
        await live.onEvent({ id, status: 'accepted' });
        await live.onEvent({ id, status: 'applied' });
        resolve();
      },
    });
    await steering.enqueue('live', 'Make it brief now');
    await supplied;
    finished = true;
    return providerSuccess({
      text: JSON.stringify({ type: 'result', value: { summary: received }, citations: [] }),
      toolCalls: [],
      finishReason: 'complete',
    });
  });
  const selected = {
    ...provider,
    capabilities: { ...provider.capabilities, midTurnSteering: true },
  };
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search: async () => ({ status: 'available', publications: [] }) },
    consent: { authorize: async () => 'authorized' },
  });
  const options = workflowOptions(selected, tool);
  const event = jest.fn();
  const result = await runMultiAgentWorkflow(
    {
      ...options,
      execution: {
        ...options.execution,
        budget: { ...options.execution.budget, maxModelCalls: 2 },
      },
      task: { ...options.task, isEvidenceIndependentResult: () => true },
      tools: [],
      operationJournal: { ...operationJournalFixture().journal, steering },
    },
    { onTaskStreamEvent: event },
  );
  expect(result).toMatchObject({ status: 'result', value: { summary: 'Make it brief now' } });
  expect(generate).toHaveBeenCalledTimes(1);
  expect(rows[0].status).toBe('applied');
  expect(event).toHaveBeenCalledWith({ type: 'steering_applied' });
});
