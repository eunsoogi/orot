import { LOCAL_MEMORY_MAX_RESULTS } from '@orot/agent-runtime';
import type { AgentMemoryHit, AgentMemoryService } from '@orot/agent-memory';
import {
  providerVisibleAgentMemory,
  providerVisibleMemoryReader,
} from '../providerVisibleMemory';

const open = (id: string): AgentMemoryHit => ({
  id,
  memoryKey: 'visible:' + id,
  text: 'Synthetic eligible text',
  kind: 'reviewed_interaction',
  score: 0.8,
  provenance: {
    sourceIds: ['synthetic-reviewed'],
    reviewState: 'human_reviewed',
  },
  createdAt: 1,
});

const privateByKey = {
  ...open('local-key'),
  memoryKey: 'manual-history-memory:conversation-local-memory:synthetic',
};
const privateBySource = {
  ...open('local-id'),
  provenance: {
    ...open('x').provenance,
    sourceIds: ['conversation-local-memory:synthetic'],
  },
};
const privateByTypedSource = {
  ...open('local-reference'),
  provenance: {
    ...open('x').provenance,
    sourceReferences: [
      {
        kind: 'manual_history',
        id: 'conversation-local-memory:auto:synthetic',
      },
    ],
  },
};

/** Only recall is under test; all other wrapper methods stay uncalled. */
function fixtures(order: readonly AgentMemoryHit[]) {
  const recall = jest.fn(
    async (
      _query: string,
      _opts?: { limit?: number; tags?: string[]; minSimilarity?: number },
    ) => [...order],
  );
  const query = providerVisibleMemoryReader({ recall });
  const graph = providerVisibleAgentMemory({
    recall,
  } as unknown as AgentMemoryService);
  return { recall, query, graph };
}

test('each adapter ranks once, preserves query options and eligible ordering, and keeps the original limit', async () => {
  const x = open('x');
  const y = open('y');
  const z = open('z');
  const { recall, graph, query } = fixtures([
    privateByKey,
    x,
    privateBySource,
    y,
    privateByTypedSource,
    z,
  ]);
  const selected = {
    limit: 2,
    tags: ['reviewed_interaction'],
    minSimilarity: 0.7,
  };
  expect(await graph.recall('query', selected)).toEqual([x, y]);
  expect(recall).toHaveBeenCalledTimes(1);
  expect(recall).toHaveBeenCalledWith('query', {
    ...selected,
    limit: 2 + LOCAL_MEMORY_MAX_RESULTS,
  });
  expect(selected.limit).toBe(2);
  recall.mockClear();
  expect(await query.recall('query', { limit: 2 })).toEqual([x, y]);
  expect(recall).toHaveBeenCalledTimes(1);
  expect(recall).toHaveBeenCalledWith('query', {
    limit: 2 + LOCAL_MEMORY_MAX_RESULTS,
  });
});

test.each([4, 5])(
  'uses the same pinned search window and final cap for local page %s',
  async limit => {
    const visible = Array.from({ length: 8 }, (_, index) =>
      open(`eligible-${index}`),
    );
    const late = {
      ...open('too-late'),
      get provenance(): AgentMemoryHit['provenance'] {
        throw new Error('The wrapper must not inspect the ninth candidate.');
      },
    };
    const { recall, graph, query } = fixtures([
      privateByKey,
      ...visible.slice(0, 2),
      privateByTypedSource,
      ...visible.slice(2, 6),
      late,
      ...visible.slice(6),
    ]);
    for (const port of [query, graph]) {
      recall.mockClear();
      expect(await port.recall('query', { limit })).toEqual(
        visible.slice(0, limit),
      );
      expect(recall.mock.calls).toEqual([['query', { limit: 8 }]]);
    }
  },
);

test('many private hits are not exposed, expanded across pages or filtered beyond the fixed local window', async () => {
  const late = {
    ...open('too-late'),
    get provenance(): AgentMemoryHit['provenance'] {
      throw new Error('The bounded wrapper must not inspect a late candidate.');
    },
  };
  const { recall, graph } = fixtures([
    ...Array<AgentMemoryHit>(1 + LOCAL_MEMORY_MAX_RESULTS).fill(
      privateBySource,
    ),
    late,
    ...Array<AgentMemoryHit>(200).fill(privateByTypedSource),
  ]);
  expect(await graph.recall('query', { limit: 1 })).toEqual([]);
  expect(recall).toHaveBeenCalledTimes(1);
  expect(recall).toHaveBeenCalledWith('query', {
    limit: 1 + LOCAL_MEMORY_MAX_RESULTS,
  });
});

test.each([undefined, 0, -3, Number.NaN, Number.MAX_SAFE_INTEGER])(
  'does not expand a missing, invalid or large legacy limit: %s',
  async limit => {
    const eligible = open('eligible');
    const { recall, graph, query } = fixtures([
      privateByKey,
      privateByTypedSource,
      eligible,
    ]);
    const original = limit === undefined ? undefined : { limit };
    for (const port of [query, graph]) {
      recall.mockClear();
      expect(await port.recall('query', original)).toEqual([eligible]);
      expect(recall).toHaveBeenCalledTimes(1);
      expect(recall.mock.calls[0]?.[1]).toBe(original);
    }
  },
);
