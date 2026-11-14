import { withDeferredEvidenceAdapters } from '../src/multiAgent/workflowCheckpoint';
import {
  DEFAULT_MULTI_AGENT_BUDGET,
  type EvidenceBatch,
  type EvidenceItem,
  type MultiAgentWorkflowOptions,
} from '../src';
import { restoreRunEvidence } from '../src/multiAgent/workflowSupport';
import type { WorkflowState } from '../src/multiAgent/state';

const item = (id: string): EvidenceItem => ({
  sourceKind: 'generated_artifact',
  sourceId: id,
  sourceRevision: 'r',
  evidenceId: id,
  evidenceRevision: 'r',
  locator: { id },
  effectiveTime: null,
  reviewState: 'unknown',
  content: `Synthetic ${id}`,
});
const page = (id: string): EvidenceBatch => ({
  items: [item(id)],
  conflicts: [],
  coverage: [
    {
      sourceKind: 'generated_artifact',
      searchedSourceIds: [id],
      gaps: [],
      truncated: true,
      selectionMethod: 'paged_retrieval',
      nextCursor: `research-page-${id}`,
      resultLimit: 1,
      returnedCount: 1,
    },
  ],
});
function fixture() {
  const batches = [page('1'), page('2')];
  const restore = jest.fn(async () => batches);
  const validate = jest.fn(async () => true);
  const fallback = jest.fn();
  const options = {
    execution: {
      allowedScope: { sourceKinds: ['generated_artifact'] },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    },
    revalidateEvidence: validate,
    restoreEvidenceBatches: restore,
    restoreEvidence: fallback,
  } as unknown as MultiAgentWorkflowOptions<unknown>;
  const state = { evidenceReferences: batches.flatMap((batch) => batch.items) } as WorkflowState;
  return { batches, restore, validate, fallback, options, state };
}

test('ordered page coverage remains exact while each page and accumulated references pass validation', async () => {
  const f = fixture();
  const result = await restoreRunEvidence(f.options, f.state, new AbortController().signal);
  expect(result).toEqual({
    items: f.batches.flatMap((batch) => batch.items),
    coverage: f.batches.flatMap((batch) => batch.coverage),
    conflicts: [],
  });
  expect(result?.coverage.map((value) => value.returnedCount)).toEqual([1, 1]);
  expect(f.validate).toHaveBeenCalledTimes(1);
  expect(f.fallback).not.toHaveBeenCalled();
});

test.each(['count', 'scope', 'duplicate', 'order', 'budget', 'missing', 'extra-batches'] as const)(
  'invalid %s cannot use fallback or weaken a page contract',
  async (mode) => {
    const f = fixture();
    if (mode === 'count')
      f.batches[0] = {
        ...f.batches[0]!,
        coverage: [{ ...f.batches[0]!.coverage[0]!, returnedCount: 2 }],
      };
    if (mode === 'scope')
      f.batches[0] = { ...f.batches[0]!, items: [{ ...item('1'), sourceKind: 'personal_record' }] };
    if (mode === 'duplicate') {
      f.batches[1] = f.batches[0]!;
      f.state = { ...f.state, evidenceReferences: [item('1'), item('1')] };
    }
    if (mode === 'order') f.batches.reverse();
    if (mode === 'budget')
      f.options = {
        ...f.options,
        execution: {
          ...f.options.execution,
          budget: { ...DEFAULT_MULTI_AGENT_BUDGET, maxEvidenceItems: 1 },
        },
      };
    if (mode === 'missing') f.batches.pop();
    if (mode === 'extra-batches')
      f.batches.push(
        { items: [], coverage: [], conflicts: [] },
        { items: [], coverage: [], conflicts: [] },
      );
    expect(
      await restoreRunEvidence(f.options, f.state, new AbortController().signal),
    ).toBeUndefined();
    expect(f.fallback).not.toHaveBeenCalled();
  },
);

test('source veto and abort precede any protected batch restoration', async () => {
  const f = fixture();
  f.validate.mockResolvedValue(false);
  expect(
    await restoreRunEvidence(f.options, f.state, new AbortController().signal),
  ).toBeUndefined();
  expect(f.restore).not.toHaveBeenCalled();
  f.validate.mockResolvedValue(true);
  const controller = new AbortController();
  controller.abort();
  expect(await restoreRunEvidence(f.options, f.state, controller.signal)).toBeUndefined();
  expect(f.restore).not.toHaveBeenCalled();
});

test.each(['before', 'after'] as const)(
  'zero-reference cancellation %s scheduling never dispatches the batch adapter',
  async (when) => {
    const f = fixture();
    const controller = new AbortController();
    if (when === 'before') controller.abort();
    const result = restoreRunEvidence(
      withDeferredEvidenceAdapters(f.options),
      { ...f.state, evidenceReferences: [] },
      controller.signal,
    );
    if (when === 'after') controller.abort();
    expect(await result).toBeUndefined();
    await Promise.resolve();
    expect(f.restore).not.toHaveBeenCalled();
    expect(f.validate).not.toHaveBeenCalled();
  },
);
