import { runMigrations } from '@orot/storage';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { coldRagFactoryFixture } from './coldRagFactoryFixture';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { runContinuableConversationWorkflow } from '../../../ragConversation/conversationWorkflowContinuation';
const { makeProvider } = jest.requireActual<{
  makeProvider(outputs: string[]): {
    provider: LanguageModelProvider;
    generate: jest.Mock;
  };
}>(
  '../../../../../../packages/agent-runtime/__tests__/multiAgent-external-evidence-fixtures',
);

/** Synthetic process restart fixture: protected DB and graph are real; provider/network are not. */
export async function coldPausedConversationFixture() {
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
    const storage = createConversationArtifactStorage(connection.database);
    await storage.createSession('session', await storage.currentGeneration());
    await storage.startRequest({
      id: 'request',
      sessionId: 'session',
      sessionVersion: 0,
      question: f.options.request,
      createdAt: '2026-11-14T00:00:00.000Z',
    });
    let pause = () => {};
    f.authorize.mockImplementation(async () => {
      pause();
      return 'authorized';
    });
    const persisted = await storage.openWorkflowContinuation(
      { requestId: 'request', sessionId: 'session', sessionVersion: 0 },
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
    const result = await runContinuableConversationWorkflow(
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
    if (result.status !== 'paused') throw new Error('Fixture did not pause.');
    f.authorize.mockImplementation(async () => 'authorized');
    return { ...f, connection, storage, generate };
  } catch (error) {
    connection.close();
    throw error;
  }
}
