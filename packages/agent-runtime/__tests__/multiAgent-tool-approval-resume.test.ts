import { MemorySaver } from '@langchain/langgraph/web';
import { providerSuccess, type LanguageModelRequest } from '@orot/model-runtime';
import {
  createEuropePmcEvidenceSearchTool,
  createMultiAgentPauseController,
  runMultiAgentWorkflow,
  type EvidenceBatch,
} from '../src';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';
import { operationJournalFixture } from './workflow-operation-journal-fixture';

function fixture(pauseAt: 'tool' | 'model') {
  const pause = createMultiAgentPauseController();
  let evidence: EvidenceBatch = { items: [], coverage: [], conflicts: [] };
  const search = jest.fn(async () => ({
    status: 'available' as const,
    publications: [publication],
  }));
  let toolApprovals = 0;
  const externalConsent = {
    authorize: jest.fn(async () => {
      if (++toolApprovals === 1 && pauseAt === 'tool') pause.requestPause();
      return 'authorized' as const;
    }),
  };
  const adapter = createEuropePmcEvidenceSearchTool({
    service: { search },
    consent: externalConsent,
  });
  const tool = {
    ...adapter,
    async prepareAuthorizedSearch(
      ...args: Parameters<NonNullable<typeof adapter.prepareAuthorizedSearch>>
    ) {
      const prepared = await adapter.prepareAuthorizedSearch!(...args);
      if (prepared.status !== 'authorized') return prepared;
      return {
        status: 'authorized' as const,
        async dispatch() {
          const result = await prepared.dispatch();
          if (!('status' in result)) evidence = result;
          return result;
        },
      };
    },
  };
  const requests: LanguageModelRequest[] = [];
  const base = makeProvider([]).provider;
  const provider = {
    ...base,
    capabilities: { ...base.capabilities, toolCalling: true },
    generate: jest.fn(async (request: LanguageModelRequest) => {
      requests.push(request);
      return requests.length === 1
        ? providerSuccess({
            text: '',
            finishReason: 'tool_calls' as const,
            toolCalls: [
              { id: 'synthetic-call', name: tool.id, arguments: { query: 'synthetic literature' } },
            ],
          })
        : providerSuccess({
            text: scriptedOutputs()[2]!,
            finishReason: 'complete' as const,
            toolCalls: [],
          });
    }),
  };
  let approvals = 0;
  const consent = {
    authorize: jest.fn(async () => {
      if (++approvals === 2 && pauseAt === 'model') pause.requestPause();
      return 'authorized' as const;
    }),
  };
  const journal = operationJournalFixture();
  const options = {
    ...workflowOptions(provider, tool),
    consent,
    checkpointer: new MemorySaver(),
    operationJournal: journal.journal,
    restoreEvidence: async () => evidence,
  };
  const config = { configurable: { thread_id: 'synthetic-native-tool-approval' } };
  return {
    pause,
    options,
    config,
    requests,
    search,
    consent,
    externalConsent,
    records: journal.records,
  };
}

test('external query approval pauses with zero search and restores the exact native tool handoff', async () => {
  const f = fixture('tool');
  const first = await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause });
  expect(first).toMatchObject({ status: 'paused' });
  expect(first.checkpoint.awaitingAuthorization).toBe('tool-1');
  expect(f.search).not.toHaveBeenCalled();
  const second = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: createMultiAgentPauseController(),
  });
  expect(second.status).toBe('result');
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(f.requests).toHaveLength(2);
  expect(f.externalConsent.authorize).toHaveBeenCalledTimes(2);
  expect(f.requests[1]!.messages.filter((message) => message.role === 'tool')).toEqual([
    expect.objectContaining({ toolCallId: 'synthetic-call' }),
  ]);
});

test('model approval after a completed native tool restores history without searching again', async () => {
  const f = fixture('model');
  const first = await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause });
  expect(first).toMatchObject({ status: 'paused' });
  expect(first.checkpoint.awaitingAuthorization).toBe('model-2');
  expect(f.search).toHaveBeenCalledTimes(1);
  const second = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: createMultiAgentPauseController(),
  });
  expect(second.status).toBe('result');
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(f.externalConsent.authorize).toHaveBeenCalledTimes(1);
  expect(f.requests).toHaveLength(2);
  expect(f.requests[1]!.messages.filter((message) => message.role === 'tool')).toHaveLength(1);
});

test('an uncertain external-search dispatch intent is not retried after a saved approval pause', async () => {
  const f = fixture('tool');
  expect(
    (await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause })).status,
  ).toBe('paused');
  f.records.get('tool-1:search')!.state = { status: 'pending' };
  const result = await runMultiAgentWorkflow(f.options, {
    config: f.config,
    pause: createMultiAgentPauseController(),
  });
  expect(result.status).toBe('unavailable');
  expect(f.search).not.toHaveBeenCalled();
  expect(f.externalConsent.authorize).toHaveBeenCalledTimes(1);
});

test('a changed source blocks query continuation before a second approval or network dispatch', async () => {
  const f = fixture('model');
  expect(
    (await runMultiAgentWorkflow(f.options, { config: f.config, pause: f.pause })).status,
  ).toBe('paused');
  f.options.revalidateEvidence = async () => false;
  expect(
    (
      await runMultiAgentWorkflow(f.options, {
        config: f.config,
        pause: createMultiAgentPauseController(),
      })
    ).status,
  ).toBe('stale_evidence');
  expect(f.search).toHaveBeenCalledTimes(1);
  expect(f.requests).toHaveLength(1);
});
