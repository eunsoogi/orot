import { steeringFinalBoundary } from '../src/multiAgent/steeringFinalBoundary';
import { providerSuccess } from '@orot/model-runtime';
import {
  createEuropePmcEvidenceSearchTool,
  runMultiAgentWorkflow,
  type WorkflowSteeringStore,
} from '../src';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';
import { operationJournalFixture } from './workflow-operation-journal-fixture';

/** Late provider-time input exercises actual graph routing, not only an enqueue receipt. */
test.each([1, 3])(
  'late final-call steering respects the original %s-call budget',
  async (maxModelCalls) => {
    const { provider, generate } = makeProvider([]);
    let rows: Awaited<ReturnType<WorkflowSteeringStore['list']>> = [];
    const bound = new Map<string, string[]>();
    const steering: WorkflowSteeringStore = {
      enqueue: async (id, text) => {
        rows = [...rows, { id, text, sequence: 1, status: 'queued' }];
        return true;
      },
      list: async () => rows,
      bind: async (id, request) => {
        const queued = rows.filter((row) => row.status === 'queued');
        bound.set(
          id,
          queued.map((row) => row.id),
        );
        rows = rows.map((row) => (queued.includes(row) ? { ...row, status: 'prepared' } : row));
        return {
          ...request,
          messages: [
            ...request.messages,
            ...queued.map((row) => ({ role: 'user' as const, content: row.text })),
          ],
        };
      },
      acknowledge: async (id) => {
        rows = rows.map((row) =>
          bound.get(id)?.includes(row.id) ? { ...row, status: 'applied' } : row,
        );
        return true;
      },
    };
    generate.mockImplementation(async (request) => {
      if (generate.mock.calls.length === 1) await steering.enqueue('late', 'Make the answer brief');
      const steered = request.messages.some(
        (message) => message.content === 'Make the answer brief',
      );
      return providerSuccess({
        text: JSON.stringify({
          type: 'result',
          value: { summary: steered ? 'Brief answer' : 'Original answer' },
          citations: [],
        }),
        toolCalls: [],
        finishReason: 'complete',
      });
    });
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search: async () => ({ status: 'available', publications: [] }) },
      consent: { authorize: async () => 'authorized' },
    });
    const options = workflowOptions(provider, tool);
    const result = await runMultiAgentWorkflow({
      ...options,
      execution: { ...options.execution, budget: { ...options.execution.budget, maxModelCalls } },
      task: { ...options.task, isEvidenceIndependentResult: () => true },
      tools: [],
      operationJournal: { ...operationJournalFixture().journal, steering },
    });
    expect(result.status).toBe('result');
    expect(generate).toHaveBeenCalledTimes(maxModelCalls === 1 ? 1 : 2);
    expect(rows[0]?.status).toBe(maxModelCalls === 1 ? 'queued' : 'applied');
    if (maxModelCalls > 1) {
      expect(result).toEqual(expect.objectContaining({ value: { summary: 'Brief answer' } }));
      expect(options.consent.authorize).toHaveBeenLastCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            messages: expect.arrayContaining([{ role: 'user', content: 'Make the answer brief' }]),
          }),
        }),
      );
    }
  },
);

test.each(['committed', 'invalid', 'cancelled'] as const)(
  'never reruns an unsafe final boundary: %s',
  async (reason) => {
    const list = jest.fn(async () => [{ status: 'queued' }]);
    const controller = new AbortController();
    if (reason === 'cancelled') controller.abort();
    const context = {
      signal: controller.signal,
      outcome: { status: reason === 'invalid' ? 'invalid_output' : 'result' },
      options: { operationJournal: { steering: { list } } },
    } as unknown as import('../src/multiAgent/runtimeContext').RuntimeContext<unknown>;
    const state = {
      modelCalls: 1,
      budget: { maxModelCalls: 3 },
      committedAction: reason === 'committed',
    } as import('../src/multiAgent/state').WorkflowState;
    const final = { phase: 'complete' as const, terminal: true };
    expect(await steeringFinalBoundary(context, state, final)).toBe(final);
    expect(list).not.toHaveBeenCalled();
  },
);
