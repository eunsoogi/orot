import { createConversationTurnRetention } from '../../../ragConversation/conversationTurnRetention';
import { runMigrations } from '@orot/storage';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { coldRagFactoryFixture } from '../testSupport/coldRagFactoryFixture';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { runContinuableConversationWorkflow } from '../../../ragConversation/conversationWorkflowContinuation';
import { resumeColdRagConversation } from '../resumeColdRagConversation';
import { createConversationColdResumeStorage } from '../../../storage/conversationColdResumeStorage';
const { makeProvider } = jest.requireActual<{
  makeProvider(outputs: string[]): {
    provider: LanguageModelProvider;
    generate: jest.Mock;
  };
}>(
  '../../../../../../packages/agent-runtime/__tests__/multiAgent-external-evidence-fixtures',
);
const identity = {
  requestId: 'request',
  sessionId: 'session',
  sessionVersion: 0,
};

/** Real app cold endpoint + SQLite + LangGraph, with a synthetic provider only. */
test('queued steering survives a real graph pause and cold reconstruction without duplicate dispatch', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    const f = await coldRagFactoryFixture();
    const { generate } = makeProvider([
      JSON.stringify({
        type: 'result',
        value: {
          answerKind: 'conversation',
          answer: '어떤 점이 궁금하신가요?',
        },
        citations: [],
      }),
    ]);
    const provider = { ...f.selected.provider, generate, stream: undefined };
    f.options.provider = provider;
    f.dependencies.selectedAi.mockResolvedValue({ ...f.selected, provider });
    const requests = createConversationArtifactStorage(connection.database);
    await requests.createSession('session', await requests.currentGeneration());
    await requests.startRequest({
      ...identity,
      id: 'request',
      question: f.options.request,
      createdAt: '2026-11-14T00:00:00.000Z',
    });
    const persisted = await requests.openWorkflowContinuation(
      identity,
      async input => ({
        ...f.descriptor.reconstruction,
        evidenceBatches: JSON.parse(JSON.stringify(input.evidenceBatches)),
        completion: {
          version: 1,
          entryContext: null,
          priorDialogue: [],
          priorUserReports: [],
          historySources: [],
          reportReferences: [],
          localRetrievalFailed: false,
        },
      }),
    );
    const initialize = persisted.initialize.bind(persisted);
    persisted.initialize = async (...args) => {
      await initialize(...args);
      expect(
        await persisted.operationJournal!.steering!.enqueue(
          'synthetic-steering',
          'Use plain words',
        ),
      ).toBe(true);
    };
    let pause = () => {};
    f.authorize.mockImplementation(async () => {
      pause();
      return 'authorized';
    });
    const initial = await runContinuableConversationWorkflow(
      f.options,
      {},
      {
        persisted,
        bindPause: next => {
          pause = next;
        },
        waitForContinue: async () => false,
      },
    );
    expect(initial.status).toBe('paused');
    expect(generate).not.toHaveBeenCalled();
    expect(
      await createConversationColdResumeStorage(connection.database).open(
        identity,
      ),
    ).toBeDefined();
    f.authorize.mockImplementation(async () => 'authorized');
    const turn = createConversationTurnRetention({
      storage: requests,
      sessionId: 'session',
      turnId: 'request',
      sessionVersion: 0,
      createdAt: '2026-11-14T00:00:00.000Z',
      restored: true,
    });
    const onSteeringReady = jest.fn();
    const resume = () =>
      resumeColdRagConversation({
        database: connection.database,
        identity,
        dependencies: f.dependencies,
        signal: new AbortController().signal,
        observer: {
          retentionRequestId: 'request',
          retentionSession: { id: 'session', version: 0 },
          onWorkflowPauseController: () => {},
          onRetentionCandidate: turn.save,
          onSteeringReady,
        },
      });
    const result = await resume();
    expect(result.status).toBe('completed');
    expect(onSteeringReady).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    const dispatched = generate.mock.calls[0][0];
    expect(dispatched.messages).toEqual(
      expect.arrayContaining([{ role: 'user', content: 'Use plain words' }]),
    );
    expect(f.authorize).toHaveBeenCalledWith(
      expect.objectContaining({ payload: dispatched }),
    );
    expect(
      (
        await connection.database.execute(
          'SELECT status FROM conversation_steering',
        )
      ).rows,
    ).toEqual([{ status: 'applied' }]);
    await expect(resume()).rejects.toThrow();
    expect(generate).toHaveBeenCalledTimes(1);
  } finally {
    connection.close();
  }
});
