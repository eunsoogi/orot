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
