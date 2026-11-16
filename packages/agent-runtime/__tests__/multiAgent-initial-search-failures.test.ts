import { MemorySaver } from '@langchain/langgraph/web';
import {
  createMultiAgentPauseController,
  runMultiAgentWorkflow,
  type EvidenceBatch,
  type EvidenceSearchTool,
} from '../src';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';
import { operationJournalFixture } from './workflow-operation-journal-fixture';

// A recoverable adapter batch must not make uncertain dispatch, persistence, or
// freshness failures recoverable. These synthetic ports expose those boundaries.
test.each(['dispatch', 'journal', 'freshness'] as const)(
  'initial lookup retains terminal %s failures',
  async (failure) => {
    const batch: EvidenceBatch = {
      items: [],
      conflicts: [],
      coverage: [
        {
          sourceKind: 'external_medical',
          searchedSourceIds: ['public-web'],
          gaps: ['known retrieval unavailable'],
          truncated: true,
          resultLimit: 1,
          returnedCount: 0,
        },
      ],
    };
    const dispatch = jest.fn(async () => {
      if (failure === 'dispatch') throw new Error('unknown adapter outcome');
      return batch;
    });
    const tool: EvidenceSearchTool = {
      id: 'public-web-search',
      sourceKind: 'external_medical',
      execution: 'external_read_only',
      description: 'Synthetic unavailable public lookup',
      inputSchema: { type: 'object' },
      parseInput: () => ({}),
      search: dispatch,
      prepareAuthorizedSearch: async () => ({ status: 'authorized', dispatch }),
    };
    const { provider, generate } = makeProvider([]);
    const journal = operationJournalFixture();
    if (failure === 'journal') journal.journal.complete = async () => false;
    const options = {
      ...workflowOptions(provider, tool),
      initialSearch: { toolId: tool.id, input: {} },
      checkpointer: new MemorySaver(),
      operationJournal: journal.journal,
      revalidateEvidence: async () => failure !== 'freshness',
    };
    const result = await runMultiAgentWorkflow(options, {
      pause: createMultiAgentPauseController(),
      config: { configurable: { thread_id: `failure-${failure}` } },
    });
    expect(['unavailable', 'stale_evidence']).toContain(result.status);
    expect(result.checkpoint.initialSearchStatus).toBe('pending');
    expect(generate).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledTimes(1);
  },
);
