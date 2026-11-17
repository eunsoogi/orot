import { createLangChainEvidenceTool } from '../src/langchain/evidenceTool';
import { restoreOrderedEvidenceBatches } from '../src/multiAgent/evidenceRestoration';
import { referencesFromBatch } from '../src/multiAgent/evidence';
import { DEFAULT_MULTI_AGENT_BUDGET } from '../src';
import type { MultiAgentWorkflowOptions } from '../src';
import { fixture } from './langchain-evidenceTool-fixtures';

// The trusted capability, not model tool arguments, opts out of artificial byte ceilings.
test('unbounded search admits large input and evidence while still rejecting source broadening', async () => {
  const f = fixture();
  const request = { ...f.request, executionLimits: 'unbounded' as const };
  const large = {
    ...f.batch,
    items: f.batch.items.map((item) => ({ ...item, content: 'x'.repeat(70_000) })),
  };
  const search = jest.fn(async () => large);
  const context = { ...f.context, reserveSearch: () => request };
  const tool = createLangChainEvidenceTool({ ...f.domain, search }, context);
  const result = JSON.parse((await tool.invoke({ query: 'q'.repeat(70_000) })) as string);
  expect(result.status).toBe('result');
  expect(result.batch.items[0].content).toHaveLength(70_000);
  expect(search.mock.calls).toHaveLength(1);
  expect(context.revalidateEvidence).toHaveBeenCalledTimes(1);
  const broadened = createLangChainEvidenceTool(
    {
      ...f.domain,
      search: async () => ({
        ...large,
        items: large.items.map((item) => ({ ...item, sourceId: 'not-approved' })),
      }),
    },
    context,
  );
  expect(JSON.parse((await broadened.invoke({ query: 'x' })) as string).status).toBe(
    'invalid_output',
  );
});

test('restores more than the old call quota of protected pages without losing exact revisions', async () => {
  const f = fixture();
  const batches = Array.from({ length: 12 }, (_, index) => ({
    ...f.batch,
    items: f.batch.items.map((item) => ({
      ...item,
      evidenceId: `e-${index}`,
      content: 'x'.repeat(70_000),
    })),
  }));
  const references = batches.flatMap(referencesFromBatch);
  const options = {
    execution: {
      allowedScope: f.request.allowedScope,
      budget: { ...DEFAULT_MULTI_AGENT_BUDGET, executionLimits: 'unbounded' },
    },
    restoreEvidenceBatches: async () => batches,
  } as unknown as MultiAgentWorkflowOptions<unknown>;
  expect(
    (await restoreOrderedEvidenceBatches(options, references, f.controller.signal))?.items,
  ).toHaveLength(12);
  const changed = references.map((reference, index) =>
    index === 11 ? { ...reference, evidenceRevision: 'wrong' } : reference,
  );
  expect(
    await restoreOrderedEvidenceBatches(options, changed, f.controller.signal),
  ).toBeUndefined();
  f.controller.abort();
  expect(
    await restoreOrderedEvidenceBatches(options, references, f.controller.signal),
  ).toBeUndefined();
});
