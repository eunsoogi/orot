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

/** Real SQLite + LangGraph + app factory and final retention gates; all provider responses synthetic. */
test.each([
  'complete',
  'repause',
  'concurrent',
  'selection',
  'post-claim-selection',
  'stop',
  'owner',
  'completion',
])('cold endpoint preserves one original request (%s)', async mode => {
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
    let pause = () => {};
    f.authorize.mockImplementation(async () => {
      pause();
      return 'authorized';
    });
    // Capture the exact pre-search factory, while the live storage hook supplies boundary/epoch binding.
    const persisted = await requests.openWorkflowContinuation(
      identity,
      async input => ({
        ...f.descriptor.reconstruction,
        evidenceBatches: JSON.parse(JSON.stringify(input.evidenceBatches)),
        completion:
          mode === 'completion'
            ? null
            : {
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
    expect(f.search).not.toHaveBeenCalled();
    const saved = await createConversationColdResumeStorage(
      connection.database,
    ).open(identity);
    expect(saved).toBeDefined();
    f.authorize.mockImplementation(async () => 'authorized');
    let coldPause = () => {};
    if (mode === 'repause')
      f.authorize.mockImplementation(async () => {
        coldPause();
        return 'authorized';
      });
    if (mode === 'selection')
      f.dependencies.selectedAi.mockResolvedValue({
        ...f.selected,
        provider,
        recipient: 'different-account',
      });
    if (mode === 'post-claim-selection') {
      let selections = 0;
      f.dependencies.selectedAi.mockImplementation(async () => ({
        ...f.selected,
        provider,
        recipient:
          ++selections >= 3 ? 'changed-after-claim' : f.selected.recipient,
      }));
    }
    const controller = new AbortController();
    if (mode === 'stop') controller.abort();
    const turn = createConversationTurnRetention({
      storage: requests,
      sessionId: 'session',
      turnId: 'request',
      sessionVersion: 0,
      createdAt: '2026-11-14T00:00:00.000Z',
      restored: true,
    });
    const onRetentionCandidate = jest.fn(turn.save);
    const register = jest.fn();
    const resume = () =>
      resumeColdRagConversation({
        database: connection.database,
        identity,
        dependencies: f.dependencies,
        signal: controller.signal,
        onRegistry: register,
        observer: {
          retentionRequestId:
            mode === 'owner' ? 'different-request' : 'request',
          retentionSession: { id: 'session', version: 0 },
          onWorkflowPauseController: next => {
            coldPause = next;
          },
          onRetentionCandidate,
        },
      });
    if (!['complete', 'repause', 'concurrent'].includes(mode)) {
      await expect(resume()).rejects.toThrow();
      expect(generate).not.toHaveBeenCalled();
      expect(f.search).not.toHaveBeenCalled();
      expect(onRetentionCandidate).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
      if (mode === 'post-claim-selection') {
        expect(
          (
            await connection.database.execute(
              'SELECT status, interruption_reason FROM conversation_requests',
            )
          ).rows,
        ).toEqual([
          { status: 'interrupted', interruption_reason: 'process-interrupted' },
        ]);
        expect(
          (
            await connection.database.execute(
              'SELECT claimed FROM conversation_workflow_resumes',
            )
          ).rows,
        ).toEqual([{ claimed: 1 }]);
        expect(
          await createConversationColdResumeStorage(connection.database).open(
            identity,
          ),
        ).toBeUndefined();
      }
    } else {
      if (mode === 'repause') {
        const paused = await resume();
        expect(paused.status).toBe('paused');
        expect(f.search).not.toHaveBeenCalled();
        expect(generate).not.toHaveBeenCalled();
        const next = await createConversationColdResumeStorage(
          connection.database,
        ).open(identity);
        expect(next?.attempt).toBe(1);
        expect(next?.reconstruction.completion).toEqual(
          saved?.reconstruction.completion,
        );
        f.authorize.mockImplementation(async () => 'authorized');
      }
      const results =
        mode === 'concurrent'
          ? await Promise.allSettled([resume(), resume()])
          : undefined;
      if (results)
        expect(
          results.filter(value => value.status === 'rejected'),
        ).toHaveLength(1);
      const fulfilled = results?.find(value => value.status === 'fulfilled');
      const result =
        fulfilled?.status === 'fulfilled' ? fulfilled.value : await resume();
      expect(result.status).toBe('completed');
      if (result.status === 'completed') {
        expect(result.outcome.status).toBe('answer');
        expect(result.registry).not.toBe(f.dependencies.registry);
      }
      expect(generate).toHaveBeenCalledTimes(1);
      expect(f.search).toHaveBeenCalledTimes(1);
      expect(register).toHaveBeenCalledTimes(mode === 'repause' ? 2 : 1);
      expect(onRetentionCandidate).toHaveBeenCalledTimes(1);
      expect(
        (
          await connection.database.execute(
            'SELECT id FROM conversation_artifacts',
          )
        ).rows,
      ).toEqual([{ id: 'request' }]);
      await expect(resume()).rejects.toThrow();
      expect(generate).toHaveBeenCalledTimes(1);
      expect(f.search).toHaveBeenCalledTimes(1);
    }
    expect(
      (
        await connection.database.execute(
          'SELECT id FROM conversation_requests',
        )
      ).rows,
    ).toEqual([{ id: 'request' }]);
  } finally {
    connection.close();
  }
});
