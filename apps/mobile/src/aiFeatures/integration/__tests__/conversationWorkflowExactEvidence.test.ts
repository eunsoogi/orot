import {
  DEFAULT_MULTI_AGENT_BUDGET,
  type MultiAgentWorkflowOptions,
  type EvidenceBatch,
} from '@orot/agent-runtime';
import { conversationWorkflowEvidenceCache } from '../conversationWorkflowEvidenceCache';
import { stableJson } from '../evidenceUtils';

test('exact empty-page coverage and embedded JSON order survive protected storage without a search', async () => {
  const page: EvidenceBatch = {
    items: [],
    conflicts: [],
    coverage: [
      {
        sourceKind: 'generated_artifact',
        searchedSourceIds: [],
        gaps: [],
        truncated: true,
        selectionMethod: 'paged_retrieval',
        nextCursor: 'research-page-1',
        resultLimit: 8,
        returnedCount: 0,
      },
    ],
  };
  const search = jest.fn(async () => page);
  const options = {
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    context: {
      previousConversation: [{ question: 'Synthetic', answer: 'Only fixture' }],
    },
    tools: [{ search }],
    execution: {
      allowedScope: { sourceKinds: ['generated_artifact'] },
      budget: DEFAULT_MULTI_AGENT_BUDGET,
    },
  } as unknown as MultiAgentWorkflowOptions<unknown>;
  const live = conversationWorkflowEvidenceCache(options);
  const first = await live.tools[0]!.search({} as never);
  if ('status' in first) throw new Error('Unexpected consent');
  const stored = JSON.parse(stableJson(live.snapshotEvidence()));
  const fresh = conversationWorkflowEvidenceCache(options, stored);
  const restored = await fresh.restoreEvidenceBatches(
    [],
    new AbortController().signal,
  );
  const result = { coverage: restored.flatMap(batch => batch.coverage) };
  expect(JSON.stringify(result.coverage)).toBe(JSON.stringify(first.coverage));
  expect(result.coverage[0]?.nextCursor).toBe('research-page-1');
  expect(JSON.stringify(fresh.context)).toBe(JSON.stringify(live.context));
  expect(search).toHaveBeenCalledTimes(1);
  Object.assign(page.coverage[0]!, { nextCursor: 'changed' });
  expect(
    (
      await live.restoreEvidenceBatches([], new AbortController().signal)
    ).flatMap(batch => batch.coverage)[0]?.nextCursor,
  ).toBe('research-page-1');
});
