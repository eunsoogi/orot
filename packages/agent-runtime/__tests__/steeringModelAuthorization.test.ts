import type { LanguageModelRequest } from '@orot/model-runtime';
import { createEuropePmcEvidenceSearchTool } from '../src';
import { callModelWithEvidenceFreshness } from '../src/multiAgent/modelCallFreshness';
import type { RuntimeContext } from '../src/multiAgent/runtimeContext';
import { makeProvider, workflowOptions } from './multiAgent-external-evidence-fixtures';
import { operationJournalFixture } from './workflow-operation-journal-fixture';

/** Synthetic providers exercise the real payload approval and completed-call non-replay path. */
test('steering-bound payload reaches fresh approval and source preparation before a single dispatch', async () => {
  const { provider, generate } = makeProvider(['synthetic result']);
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search: async () => ({ status: 'available', publications: [] }) },
    consent: { authorize: async () => 'authorized' },
  });
  const options = workflowOptions(provider, tool);
  const base = operationJournalFixture();
  const request: LanguageModelRequest = { messages: [{ role: 'user', content: 'Original' }] };
  const bound: LanguageModelRequest = {
    messages: [...request.messages, { role: 'user', content: 'Use plain words' }],
  };
  const consent = { authorize: jest.fn(async () => 'authorized' as const) };
  const beforeTaskStream = jest.fn(async () => {});
  const acknowledge = jest.fn(async () => true);
  const context = {
    options: {
      ...options,
      consent,
      operationJournal: {
        ...base.journal,
        steering: {
          enqueue: async () => true,
          list: async () => [],
          bind: async () => bound,
          acknowledge,
        },
      },
    },
    signal: new AbortController().signal,
    timedOut: () => false,
    currentEvidence: options.initialEvidence,
    beforeTaskStream,
    activeModelOperation: { operationKey: 'model-1', callIndex: 0 },
  } as RuntimeContext<unknown>;
  expect((await callModelWithEvidenceFreshness(context, request))?.status).toBe('response');
  expect(consent.authorize).toHaveBeenCalledWith(expect.objectContaining({ payload: bound }));
  expect(beforeTaskStream).toHaveBeenCalledWith(
    expect.objectContaining({ request: bound }),
    expect.anything(),
  );
  expect(generate).toHaveBeenCalledTimes(1);
  expect(acknowledge).toHaveBeenCalledWith('model-1:call-1');
  context.activeModelOperation = { operationKey: 'model-1', callIndex: 0 };
  expect((await callModelWithEvidenceFreshness(context, request))?.status).toBe('response');
  expect(generate).toHaveBeenCalledTimes(1);
  expect(consent.authorize).toHaveBeenCalledTimes(1);
});
