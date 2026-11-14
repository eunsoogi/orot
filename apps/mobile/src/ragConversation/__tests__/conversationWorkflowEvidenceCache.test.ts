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

test('empty search coverage survives restoration without a repeated search', async () => {
  const empty: EvidenceBatch = {
    items: [],
    conflicts: [],
    coverage: [
      {
        sourceKind: 'external_medical',
        searchedSourceIds: ['synthetic-search'],
        gaps: ['No matching publications'],
        truncated: true,
        resultLimit: 1,
        returnedCount: 0,
      },
    ],
  };
  const tool = { search: jest.fn(async () => empty) };
  const cache = conversationWorkflowEvidenceCache({
    initialEvidence: { items: [], coverage: [], conflicts: [] },
    tools: [tool],
    execution: { budget: DEFAULT_MULTI_AGENT_BUDGET },
  } as unknown as MultiAgentWorkflowOptions<unknown>);
  await cache.tools[0]!.search({} as never);
  const restored = await cache.restoreEvidence(
    [],
    new AbortController().signal,
  );
  expect(restored.items).toEqual([]);
  expect(restored.coverage).toEqual([
    expect.objectContaining({
      sourceKind: 'external_medical',
      searchedSourceIds: ['synthetic-search'],
      gaps: ['No matching publications'],
      truncated: true,
      returnedCount: 0,
    }),
  ]);
  expect(tool.search).toHaveBeenCalledTimes(1);
  expect(
    validateEvidenceBatch(
      restored,
      { sourceKinds: ['external_medical'] },
      DEFAULT_MULTI_AGENT_BUDGET,
    ),
  ).toBeUndefined();
});

test('fresh cache restores protected exact batches and empty coverage without a search', async () => {
  const first = item('first');
  const empty: EvidenceBatch = {
    items: [],
    conflicts: [],
    coverage: [
      {
        sourceKind: 'external_medical',
        searchedSourceIds: ['synthetic'],
        gaps: ['empty'],
        truncated: false,
        resultLimit: 5,
        returnedCount: 0,
      },
    ],
  };
  const search = jest.fn(async () => empty);
  const options = {
    initialEvidence: batch(first),
    tools: [{ search }],
    execution: { budget: DEFAULT_MULTI_AGENT_BUDGET },
  } as unknown as MultiAgentWorkflowOptions<unknown>;
  const old = conversationWorkflowEvidenceCache(options);
  await old.tools[0]!.search({} as never);
  const snapshot = old.snapshotEvidence();
  search.mockClear();
  const fresh = conversationWorkflowEvidenceCache(options, snapshot);
  const restored = await fresh.restoreEvidence(
    [first],
    new AbortController().signal,
  );
  expect(restored.items).toEqual([first]);
  expect(restored.coverage).toContainEqual(
    expect.objectContaining({
      sourceKind: 'external_medical',
      searchedSourceIds: ['synthetic'],
      gaps: ['empty'],
      returnedCount: 0,
    }),
  );
  expect(search).not.toHaveBeenCalled();
  expect(() =>
    conversationWorkflowEvidenceCache(
      { ...options, initialEvidence: batch(item('changed')) },
      snapshot,
    ),
  ).toThrow('snapshot');
});
