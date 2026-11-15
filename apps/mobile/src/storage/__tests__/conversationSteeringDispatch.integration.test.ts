import type { LanguageModelRequest } from '@orot/model-runtime';
import { createEuropePmcEvidenceSearchTool } from '@orot/agent-runtime';
import { callModelWithEvidenceFreshness } from '../../../../../packages/agent-runtime/src/multiAgent/modelCallFreshness';
import type { RuntimeContext } from '../../../../../packages/agent-runtime/src/multiAgent/runtimeContext';
import {
  makeProvider,
  workflowOptions,
} from '../../../../../packages/agent-runtime/__tests__/multiAgent-external-evidence-fixtures';
import { conversationWorkflowContinuationFixture } from '../testSupport/conversationWorkflowContinuationFixture';
import { createConversationOperationJournal } from '../conversationOperationJournal';

/** Synthetic providers exercise the real payload approval and completed-call non-replay path. */
test('actual SQLite reconstructed steering reuses a completed call without new consent or dispatch', async () => {
  const { provider, generate } = makeProvider(['synthetic result']);
  const tool = createEuropePmcEvidenceSearchTool({
    service: {
      search: async () => ({ status: 'available', publications: [] }),
    },
    consent: { authorize: async () => 'authorized' },
  });
  const options = workflowOptions(provider, tool);
  const fixture = await conversationWorkflowContinuationFixture();
  const owner = {
    requestId: 'request',
    sessionId: 'session',
    sessionVersion: 0,
    operationRunId: 'run',
  };
  const journal = await createConversationOperationJournal(
    fixture.connection.database,
    owner,
    async () => true,
  );
  try {
    await journal.steering!.enqueue('instruction', 'Use plain words');
    const request: LanguageModelRequest = {
      messages: [{ role: 'user', content: 'Original' }],
    };
    const bound: LanguageModelRequest = {
      messages: [
        ...request.messages,
        { role: 'user', content: 'Use plain words' },
      ],
    };
    const consent = { authorize: jest.fn(async () => 'authorized' as const) };
    const beforeTaskStream = jest.fn(async () => {});

    const context = {
      options: {
        ...options,
        consent,
        operationJournal: journal,
      },
      signal: new AbortController().signal,
      timedOut: () => false,
      currentEvidence: options.initialEvidence,
      beforeTaskStream,
      activeModelOperation: { operationKey: 'model-1', callIndex: 0 },
    } as RuntimeContext<unknown>;
    expect(
      (await callModelWithEvidenceFreshness(context, request))?.status,
    ).toBe('response');
    expect(consent.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ payload: bound }),
    );
    expect(beforeTaskStream).toHaveBeenCalledWith(
      expect.objectContaining({ request: bound }),
      expect.anything(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect((await journal.steering!.list())[0].status).toBe('applied');
    const restoredJournal = await createConversationOperationJournal(
      fixture.connection.database,
      owner,
      async () => true,
    );
    const restoredContext = {
      ...context,
      options: { ...context.options, operationJournal: restoredJournal },
      activeModelOperation: { operationKey: 'model-1', callIndex: 0 },
    };
    expect(
      (await callModelWithEvidenceFreshness(restoredContext, request))?.status,
    ).toBe('response');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(consent.authorize).toHaveBeenCalledTimes(1);
  } finally {
    fixture.connection.close();
  }
});
