import { consumeNativeToolCall } from '../src/multiAgent/nativeTools';
import { reviewInitialToolResponse } from '../src/multiAgent/initialToolResponseReview';
import { callModelWithEvidenceFreshness } from '../src/multiAgent/modelCallFreshness';
import { standardSearchFixture } from './multiAgent-standard-search-fixtures';
import type { WorkflowState } from '../src/multiAgent/state';

jest.mock('../src/multiAgent/modelCallFreshness', () => ({
  callModelWithEvidenceFreshness: jest.fn(),
}));

/** Graph pause sentinels must retain object identity; treating them as preview failure dispatches tools. */
test.each(['approval pause', 'unexpected failure'])(
  'propagates %s instead of suppressing it as optional preview failure',
  async (message) => {
    const run = standardSearchFixture(true);
    const sentinel = new Error(message);
    jest.mocked(callModelWithEvidenceFreshness).mockRejectedValueOnce(sentinel);
    const context = {
      options: run.options,
      signal: new AbortController().signal,
      timedOut: () => false,
      currentEvidence: run.options.initialEvidence,
    };
    const state = {
      modelCalls: 1,
      budget: run.options.execution.budget,
    } as WorkflowState;
    await expect(reviewInitialToolResponse(context, state, 'synthetic candidate')).rejects.toBe(
      sentinel,
    );
    expect(run.provider.generate).not.toHaveBeenCalled();
    expect(run.search).not.toHaveBeenCalled();
  },
);

test('photo-bound tasks skip optional text review without weakening or invoking photo consent', async () => {
  jest.mocked(callModelWithEvidenceFreshness).mockClear();
  const run = standardSearchFixture(true);
  const authorize = jest.fn(async () => 'renewal_required' as const);
  const context = {
    options: {
      ...run.options,
      photoInput: { evidenceIds: ['synthetic-photo'], consent: { authorize } },
    },
    signal: new AbortController().signal,
    timedOut: () => false,
    currentEvidence: run.options.initialEvidence,
  };
  const state = { modelCalls: 1, budget: run.options.execution.budget } as WorkflowState;
  await expect(reviewInitialToolResponse(context, state, 'synthetic candidate')).resolves.toEqual({
    accepted: false,
    modelCalls: 1,
  });
  expect(callModelWithEvidenceFreshness).not.toHaveBeenCalled();
  expect(authorize).not.toHaveBeenCalled();
  expect(run.provider.generate).not.toHaveBeenCalled();
});

/** Production does not opt in; the runtime must not turn a disabled feature into a review call. */
test('a task without the preview opt-in never invokes the review helper', async () => {
  jest.mocked(callModelWithEvidenceFreshness).mockClear();
  const run = standardSearchFixture(true);
  const onTaskStreamEvent = jest.fn();
  const context = {
    options: run.options,
    signal: new AbortController().signal,
    timedOut: () => false,
    currentEvidence: run.options.initialEvidence,
    onTaskStreamEvent,
  };
  const state = {
    modelCalls: 1,
    toolCalls: 0,
    evidenceReferences: [],
    budget: run.options.execution.budget,
  } as WorkflowState;
  const result = await consumeNativeToolCall(context, state, {
    text: 'Unreviewed provisional answer',
    finishReason: 'tool_calls',
    toolCalls: [{ id: 'first', name: run.tool.id, arguments: { query: 'synthetic' } }],
  });
  expect(result?.phase).toBe('evidence_search');
  expect(result?.modelCalls).toBe(1);
  expect(callModelWithEvidenceFreshness).not.toHaveBeenCalled();
  expect(onTaskStreamEvent).not.toHaveBeenCalled();
});
