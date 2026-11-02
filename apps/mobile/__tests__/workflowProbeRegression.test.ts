import { runGraphIntegrationProbe } from '../e2e/graphIntegrationProbe';
import { runWorkflowProgressProbe } from '../e2e/workflowProgressProbe';
import { measureScaleCalendar } from '../e2e/aiScaleCalendar';

test('production graph preserves each node and stream state across repeated inputs', async () => {
  await expect(runGraphIntegrationProbe()).resolves.toEqual({
    invocations: 20,
    streams: 20,
    duplicateNodes: 0,
  });
});

test('production workflow exposes the ordered safe progress and buffered answer', async () => {
  const result = await runWorkflowProgressProbe();
  expect(result.successProgress).toEqual([
    'model_started:task_response',
    'model_started:evidence_research',
    'evidence_search:started:personal_record',
    'evidence_search:completed:personal_record',
    'model_started:revised_response',
  ]);
  expect(result.streamTypes).toEqual(['started', 'started', 'text_delta']);
  expect(result).toMatchObject({
    successStatus: 'result',
    projectedText: 'Synthetic answer.',
    partialVisibleBeforeCompletion: false,
    privatePayloadExposed: false,
  });
});

test('scale measurements distinguish completion, cancellation and budget exhaustion', async () => {
  const completed = await measureScaleCalendar(9);
  expect(completed).toMatchObject({
    outcome: 'completed',
    status: 'complete',
    completedBatches: 2,
  });
  const cancelled = await measureScaleCalendar(9, true);
  expect(cancelled).toMatchObject({
    outcome: 'intentionally_cancelled',
    status: 'partial',
    completedBatches: 1,
    modelCalls: 1,
  });
  const budget = await measureScaleCalendar(9, false, -1);
  expect(budget).toMatchObject({
    outcome: 'budget_exceeded',
    status: 'partial',
    completedBatches: 1,
    modelCalls: 1,
  });
  // A deadline noticed only after the final batch must not relabel completed work.
  await expect(measureScaleCalendar(8, false, -1)).resolves.toMatchObject({
    outcome: 'completed',
    status: 'complete',
    completedBatches: 1,
  });
});
