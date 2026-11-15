import {
  DEFAULT_MULTI_AGENT_BUDGET,
  type EvidenceBatch,
  type MultiAgentWorkflowOptions,
} from '../src';
import { initialState, restoreRunEvidence } from '../src/multiAgent/workflowSupport';

const emptySearch: EvidenceBatch = {
  items: [],
  conflicts: [],
  coverage: [
    {
      sourceKind: 'external_medical',
      searchedSourceIds: ['synthetic-search'],
      gaps: ['No matches'],
      truncated: true,
      resultLimit: 1,
      returnedCount: 0,
    },
  ],
};
function fixture() {
  const restoreEvidence = jest.fn(async () => emptySearch);
  const options = {
    execution: {
      operationRunId: 'synthetic',
      providerId: 'synthetic',
      modelId: 'synthetic',
      allowedScope: { sourceKinds: ['external_medical'] },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    },
    initialEvidence: emptySearch,
    restoreEvidence,
  } as unknown as MultiAgentWorkflowOptions<unknown>;
  return { options, restoreEvidence, state: initialState(options) };
}

test('restores empty-search limitations through the registered adapter', async () => {
  const f = fixture();
  expect(await restoreRunEvidence(f.options, f.state, new AbortController().signal)).toEqual(
    emptySearch,
  );
  expect(f.restoreEvidence).toHaveBeenCalledTimes(1);
});

test('does not accept out-of-scope empty coverage', async () => {
  const f = fixture();
  f.restoreEvidence.mockResolvedValue({
    ...emptySearch,
    coverage: [{ ...emptySearch.coverage[0]!, sourceKind: 'personal_record' }],
  });
  expect(
    await restoreRunEvidence(f.options, f.state, new AbortController().signal),
  ).toBeUndefined();
});

test('retains the legacy empty fallback only when no restorer exists', async () => {
  const f = fixture();
  expect(
    await restoreRunEvidence(
      { ...f.options, restoreEvidence: undefined },
      f.state,
      new AbortController().signal,
    ),
  ).toEqual({ items: [], coverage: [], conflicts: [] });
});
