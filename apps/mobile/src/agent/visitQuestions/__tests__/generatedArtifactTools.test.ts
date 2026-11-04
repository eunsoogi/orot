import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';
import { createVisitQuestionEvidenceSearchTools } from '../evidenceTools';
import type {
  EvidenceSearchRequest,
  EvidenceSearchTool,
} from '@orot/agent-runtime';

test('artifact search keeps redacted detail tokens available to the source tool', async () => {
  const aliases = createVisitQuestionEvidenceAliases({
    items: [],
    coverage: [],
    conflicts: [],
  });
  const search: EvidenceSearchTool = {
    id: 'generated',
    sourceKind: 'generated_artifact',
    execution: 'local_read_only',
    description: 'synthetic',
    inputSchema: {},
    parseInput: () => ({}),
    async search() {
      return {
        items: [
          {
            sourceKind: 'generated_artifact',
            sourceId: 's1',
            sourceRevision: 'sr1',
            evidenceId: 'e1',
            evidenceRevision: 'er1',
            locator: { kind: 'local-evidence', token: 'e1' },
            effectiveTime: null,
            reviewState: 'unreviewed',
            content: JSON.stringify({
              sources: [{ kind: 'personal_record', evidenceId: 'e42' }],
            }),
          },
        ],
        coverage: [],
        conflicts: [],
      };
    },
  };
  const detail = jest.fn(async () => ({
    items: [],
    coverage: [],
    conflicts: [],
  }));
  const tools = createVisitQuestionEvidenceSearchTools({
    aliases,
    searchEvidence: async () => {
      throw new Error('unused');
    },
    initialEvidenceCount: 0,
    maxEvidenceItems: 8,
    generatedTools: [
      search,
      {
        ...search,
        id: 'detail',
        sourceKind: 'personal_record',
        search: detail,
      },
    ],
  });
  const request = {
    operationRunId: 'run',
    operationKey: 'search',
    input: {},
    allowedScope: {
      sourceKinds: ['generated_artifact' as const, 'personal_record' as const],
    },
    resultLimit: 1,
    maxPayloadBytes: 4000,
    signal: new AbortController().signal,
  };
  const batch = await tools
    .find(tool => tool.id === 'generated')!
    .search(request);
  if ('status' in batch) throw new Error('Unexpected consent');
  expect(JSON.parse(batch.items[0]!.content).sources[0].evidenceId).toBe('e42');
  await tools
    .find(tool => tool.id === 'detail')!
    .search({ ...request, input: { evidenceId: 'e42' } });
  expect(detail).toHaveBeenCalledWith(
    expect.objectContaining({ input: { evidenceId: 'e42' } }),
    undefined,
  );
});

test('caps admitted generated parents at the storage contract limit', async () => {
  const aliases = createVisitQuestionEvidenceAliases({
    items: [],
    coverage: [],
    conflicts: [],
  });
  let sequence = 0;
  const search = jest.fn(async (_request: EvidenceSearchRequest) => {
    const id = `e${++sequence}`;
    return {
      items: [
        {
          sourceKind: 'generated_artifact' as const,
          sourceId: `s${sequence}`,
          sourceRevision: 'sr',
          evidenceId: id,
          evidenceRevision: 'er',
          locator: { kind: 'local-evidence', token: id },
          effectiveTime: null,
          reviewState: 'unreviewed' as const,
          content: 'Synthetic output',
        },
      ],
      coverage: [],
      conflicts: [],
    };
  });
  const tools = createVisitQuestionEvidenceSearchTools({
    aliases,
    searchEvidence: async () => {
      throw new Error('unused');
    },
    initialEvidenceCount: 0,
    maxEvidenceItems: 8,
    generatedTools: [
      {
        id: 'generated',
        sourceKind: 'generated_artifact',
        execution: 'local_read_only',
        description: 'synthetic',
        inputSchema: {},
        parseInput: () => ({}),
        search,
      },
    ],
  });
  const request = {
    operationRunId: 'run',
    operationKey: 'search',
    input: {},
    allowedScope: { sourceKinds: ['generated_artifact' as const] },
    resultLimit: 8,
    maxPayloadBytes: 4000,
    signal: new AbortController().signal,
  };
  const tool = tools.find(item => item.id === 'generated')!;
  await tool.search(request);
  await tool.search(request);
  await tool.search(request);
  expect(search.mock.calls.map(([value]) => value.resultLimit)).toEqual([
    3, 2, 1,
  ]);
  await expect(tool.search(request)).rejects.toThrow('generated parent limit');
});
