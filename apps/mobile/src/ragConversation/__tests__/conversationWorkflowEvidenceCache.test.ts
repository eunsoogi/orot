import type {
  EvidenceBatch,
  EvidenceItem,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import { validateEvidenceBatch } from '../../../../../packages/agent-runtime/src/multiAgent/evidence';
import { conversationWorkflowEvidenceCache } from '../../aiFeatures/integration/conversationWorkflowEvidenceCache';

const item = (id: string): EvidenceItem => ({
  sourceKind: 'personal_record',
  sourceId: id,
  sourceRevision: '1',
  evidenceId: id,
  evidenceRevision: '1',
  locator: { id },
  effectiveTime: null,
  reviewState: 'reviewed',
  content: `Synthetic ${id}`,
});
const batch = (value: EvidenceItem): EvidenceBatch => ({
  items: [value],
  conflicts: [],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: [value.sourceId],
      gaps: [],
      truncated: false,
      resultLimit: 1,
      returnedCount: 1,
    },
  ],
});

test('restores an exact reference subset across two batches with truthful union counts', async () => {
  const first = item('first'),
    second = item('second');
  const tool = { search: jest.fn(async () => batch(second)) };
  const options = {
    initialEvidence: batch(first),
    tools: [tool],
    execution: { budget: DEFAULT_MULTI_AGENT_BUDGET },
  } as unknown as MultiAgentWorkflowOptions<unknown>;
  const cache = conversationWorkflowEvidenceCache(options);
  await cache.tools[0]!.search({} as never);
  const signal = new AbortController().signal;
  const both = await cache.restoreEvidence([first, second], signal);
  expect(both.coverage).toHaveLength(1);
  expect(both.coverage[0]?.returnedCount).toBe(2);
  expect(
    validateEvidenceBatch(
      both,
      { sourceKinds: ['personal_record'] },
      DEFAULT_MULTI_AGENT_BUDGET,
    ),
  ).toBeUndefined();
  const subset = await cache.restoreEvidence([second], signal);
  expect(subset.items).toEqual([second]);
  expect(subset.coverage[0]?.returnedCount).toBe(1);
  expect(
    validateEvidenceBatch(
      subset,
      { sourceKinds: ['personal_record'] },
      DEFAULT_MULTI_AGENT_BUDGET,
    ),
  ).toBeUndefined();
  expect(tool.search).toHaveBeenCalledTimes(1);
  await expect(
    cache.restoreEvidence([item('missing')], signal),
  ).rejects.toThrow('not available');
  expect(tool.search).toHaveBeenCalledTimes(1);
});

test('prototype tool methods preserve their original receiver', async () => {
  class Tool {
    readonly id = 'prototype-tool';
    readonly sourceKind = 'personal_record' as const;
    readonly execution = 'local_read_only' as const;
    readonly description = 'synthetic';
    readonly inputSchema = {};
    private readonly marker = 'owned';
    parseInput() {
      return { marker: this.marker };
    }
    async search() {
      return batch(item(this.marker));
    }
  }
  const cache = conversationWorkflowEvidenceCache({
    initialEvidence: batch(item('first')),
    tools: [new Tool()],
    execution: { budget: DEFAULT_MULTI_AGENT_BUDGET },
  } as unknown as MultiAgentWorkflowOptions<unknown>);
  expect(cache.tools[0]!.parseInput({})).toEqual({ marker: 'owned' });
  expect(await cache.tools[0]!.search({} as never)).toEqual(
    batch(item('owned')),
  );
});
