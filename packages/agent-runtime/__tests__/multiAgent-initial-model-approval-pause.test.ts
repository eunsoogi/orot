import { MemorySaver } from '@langchain/langgraph/web';
import {
  createEuropePmcEvidenceSearchTool,
  createMultiAgentPauseController,
  runMultiAgentWorkflow,
} from '../src';
import {
  makeProvider,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';
import { operationJournalFixture } from './workflow-operation-journal-fixture';

test.each([true, false])(
  'a held initial model wait records a cooperative pause only for known decision-free preparation (%s)',
  async (decisionFree) => {
    const pause = createMultiAgentPauseController();
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let complete!: () => void;
    const parked = new Promise<void>((resolve) => {
      complete = resolve;
    });
    const { provider, requests } = makeProvider(scriptedOutputs());
    const search = jest.fn(async () => ({ status: 'available' as const, publications: [] }));
    const tool = createEuropePmcEvidenceSearchTool({
      service: { search },
      consent: { authorize: async () => 'authorized' },
    });
    const authorize = jest.fn(async () => {
      if (authorize.mock.calls.length === 1) {
        entered();
        await parked;
      }
      return 'authorized' as const;
    });
    const journal = operationJournalFixture();
    const options = {
      ...workflowOptions(provider, tool),
      consent: { authorize },
      operationJournal: journal.journal,
      checkpointer: new MemorySaver(),
    };
    const config = { configurable: { thread_id: 'prepared-initial-approval' } };
    const result = runMultiAgentWorkflow(options, {
      config,
      pause,
      onModelApprovalWait: decisionFree ? () => 'checkpoint-only' as const : undefined,
    });
    try {
      await expect(
        Promise.race([held.then(() => 'held'), result.then(() => 'returned')]),
      ).resolves.toBe('held');
      pause.requestPause();
    } finally {
      complete();
    }
    const first = await result;
    expect(first).toMatchObject({
      status: 'paused',
      checkpoint: { awaitingAuthorization: 'model-1' },
    });
    expect(first.status === 'paused' && first.pauseReason).toBe(
      decisionFree ? 'background-paused' : undefined,
    );
    expect(requests).toHaveLength(0);
    expect(search).not.toHaveBeenCalled();
  },
);
