import {
  DEFAULT_MULTI_AGENT_BUDGET,
  type MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { conversationWorkflowEvidenceCache } from '../conversationWorkflowEvidenceCache';
import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import { createPublicWebEvidence } from '../publicWebEvidence';
import { wrapEvidenceSearch } from '../wrapEvidenceSearch';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';

test('explicit preparation has no dispatch; wrapped lineage runs exactly once after dispatch', async () => {
  const f = publicEvidenceFixture();
  const original = createPublicWebEvidence(f)!;
  const retained = jest.fn();
  const wrapped = wrapEvidenceSearch(
    original.tool,
    async (_request, _runtime, dispatch) => {
      const result = await dispatch();
      retained(result);
      return result;
    },
  );
  const prepared = await wrapped.prepareAuthorizedSearch!(f.request);
  expect(prepared.status).toBe('authorized');
  expect(f.search).not.toHaveBeenCalled();
  expect(retained).not.toHaveBeenCalled();
  if (prepared.status !== 'authorized') throw new Error('Expected approval');
  const result = await prepared.dispatch();
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(retained).toHaveBeenCalledWith(result);
  expect(f.authorize).toHaveBeenCalledTimes(1);
  await expect(prepared.dispatch()).rejects.toThrow('no longer available');
  expect(retained).toHaveBeenCalledTimes(1);
});

test.each(['abort', 'query-change', 'scope-change', 'source-deleted'])(
  'prepared grant cannot dispatch after %s',
  async cause => {
    const f = publicEvidenceFixture();
    let valid = true;
    const web = createPublicWebEvidence({
      ...f,
      beforeDispatch: async () => valid,
    })!;
    const prepared = await web.tool.prepareAuthorizedSearch!(f.request);
    if (prepared.status !== 'authorized') throw new Error('Expected approval');
    if (cause === 'abort') f.controller.abort();
    if (cause === 'query-change') f.request.input = { topics: ['pain'] };
    if (cause === 'scope-change') f.request.allowedScope = { sourceKinds: [] };
    if (cause === 'source-deleted') valid = false;
    await expect(prepared.dispatch()).rejects.toThrow();
    expect(f.search).not.toHaveBeenCalled();
  },
);

test('prepared execution populates the exact evidence cache without another search', async () => {
  const f = publicEvidenceFixture();
  const web = createPublicWebEvidence(f)!;
  const cache = conversationWorkflowEvidenceCache({
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    tools: [web.tool],
    execution: { budget: DEFAULT_MULTI_AGENT_BUDGET },
  } as unknown as MultiAgentWorkflowOptions<unknown>);
  const prepared = await cache.tools[0]!.prepareAuthorizedSearch!(f.request);
  if (prepared.status !== 'authorized') throw new Error('Expected approval');
  const result = await prepared.dispatch();
  if ('status' in result) throw new Error('Expected evidence');
  const restored = await cache.restoreEvidence(
    result.items.map(referenceOnly),
    f.controller.signal,
  );
  expect(restored.items).toEqual(result.items);
  expect(f.search).toHaveBeenCalledTimes(1);
});
