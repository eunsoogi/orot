import { journaledModelCall } from '../src/multiAgent/journaledModelCall';
import type { RuntimeContext } from '../src/multiAgent/runtimeContext';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';
import { operationJournalFixture } from './workflow-operation-journal-fixture';

// Crash boundary: durable model result exists, but graph state still precedes the model node.
test('completed journal replay restores the charged successor without another provider call', async () => {
  const { provider, generate } = makeProvider(['synthetic result']);
  const { journal, records } = operationJournalFixture();
  const options = { ...workflowOptions(provider, {} as never), operationJournal: journal };
  const makeContext = () =>
    ({
      options,
      signal: new AbortController().signal,
      currentEvidence: { items: [] },
      activeModelOperation: { operationKey: 'model', callIndex: 0 },
      midTurnSteeringBudget: { available: true, used: false },
    }) as unknown as RuntimeContext<unknown>;
  const context = makeContext();
  // A live reservation is durably claimed before transport; model returns the successor.
  generate.mockImplementationOnce(async () => {
    context.midTurnSteeringBudget!.used = true;
    return {
      ok: true,
      value: { text: 'synthetic result', toolCalls: [], finishReason: 'complete' },
    };
  });
  const request = { messages: [{ role: 'user' as const, content: 'synthetic input' }] };
  const consent = { authorize: async () => 'authorized' as const };
  const outcome = await journaledModelCall(context, request, consent);
  const row = records.get('model:call-1')!.state;
  expect(row.status).toBe('completed');
  if (row.status === 'completed') expect(JSON.parse(row.result).liveSteeringReserved).toBe(true);
  const replay = makeContext();
  expect(replay.midTurnSteeringBudget!.used).toBe(false);
  expect(await journaledModelCall(replay, request, consent)).toMatchObject(outcome!);
  expect(replay.midTurnSteeringBudget!.used).toBe(true);
  expect(generate).toHaveBeenCalledTimes(1);
});
