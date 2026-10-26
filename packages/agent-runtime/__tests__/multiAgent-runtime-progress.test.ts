import type { MultiAgentProgressEvent, MultiAgentWorkflowOptions } from '../src';
import {
  canceled,
  reportProgress,
  stop,
  type RuntimeContext,
} from '../src/multiAgent/runtimeContext';

function runtimeContext(timedOut = false) {
  const progress: MultiAgentProgressEvent[] = [];
  const context = {
    options: {} as MultiAgentWorkflowOptions<string>,
    signal: new AbortController().signal,
    timedOut: () => timedOut,
    currentEvidence: { items: [], coverage: [], conflicts: [] },
    onProgress: (event: MultiAgentProgressEvent) => progress.push(event),
  } as RuntimeContext<string>;
  return { context, progress };
}

const searchStarted: MultiAgentProgressEvent = {
  type: 'evidence_search',
  status: 'started',
  sourceKind: 'personal_record',
};

test('projects an in-flight search failure once without exposing its reason', () => {
  const { context, progress } = runtimeContext();
  reportProgress(context, searchStarted);

  stop(context, 'Private local search error detail.', 'unavailable');

  expect(progress).toEqual([
    searchStarted,
    {
      type: 'evidence_search',
      status: 'failed',
      sourceKind: 'personal_record',
    },
  ]);
  expect(JSON.stringify(progress)).not.toContain('Private local search error detail.');
  expect(context.outcome?.status).toBe('unavailable');
});

test('projects user cancellation separately from search failure', () => {
  const { context, progress } = runtimeContext();
  reportProgress(context, searchStarted);

  canceled(context, 'iterator_return_requested');

  expect(progress).toEqual([
    searchStarted,
    {
      type: 'evidence_search',
      status: 'cancelled',
      sourceKind: 'personal_record',
    },
  ]);
  expect(context.outcome).toEqual({
    status: 'cancelled',
    providerStop: 'iterator_return_requested',
  });
});

test('reports timeout termination as failed while retaining the budget outcome', () => {
  const { context, progress } = runtimeContext(true);
  reportProgress(context, searchStarted);

  canceled(context);

  expect(progress.at(-1)).toEqual({
    type: 'evidence_search',
    status: 'failed',
    sourceKind: 'personal_record',
  });
  expect(context.outcome?.status).toBe('budget_exceeded');
});

test('does not fail a search that already reported completion', () => {
  const { context, progress } = runtimeContext();
  reportProgress(context, searchStarted);
  reportProgress(context, {
    type: 'evidence_search',
    status: 'completed',
    sourceKind: 'personal_record',
  });

  stop(context, 'A later response validation failed.', 'invalid_output');

  expect(progress).toEqual([
    searchStarted,
    {
      type: 'evidence_search',
      status: 'completed',
      sourceKind: 'personal_record',
    },
  ]);
});
