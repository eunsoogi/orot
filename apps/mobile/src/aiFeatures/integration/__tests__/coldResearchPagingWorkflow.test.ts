import { isMultiAgentCheckpointResumable } from '@orot/agent-runtime';
import { providerSuccess } from '@orot/model-runtime';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { createConversationTurnRetention } from '../../../ragConversation/conversationTurnRetention';
import { runContinuableConversationWorkflow } from '../../../ragConversation/conversationWorkflowContinuation';
import { createConversationColdResumeStorage } from '../../../storage/conversationColdResumeStorage';
import { coldRagFactoryFixture } from '../testSupport/coldRagFactoryFixture';
import { captureColdRagConversationState } from '../coldRagConversationState';
import { resumeColdRagConversation } from '../resumeColdRagConversation';
import { researchPagingWorkflowCatalog } from '../testSupport/researchPagingWorkflowCatalog';

/** SQLite journal + LangGraph + fresh app factory; catalog pages and provider responses are synthetic. */
test.each(['complete', 'repause', 'populated'] as const)(
  'cold Continue retains completed pages without replay (%s)',
  async mode => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(db.database);
      const catalog = await researchPagingWorkflowCatalog(
        db.database,
        mode === 'populated',
      );
      const { search } = catalog;
      const expectedCursor = mode === 'populated' ? 'research-2' : 'research-9';
      const f = await coldRagFactoryFixture(
        { version: 1, status: 'consent_required', charged: true },
        data => {
          data.researchArtifactDiscovery = async () => catalog;
        },
      );
      let calls = 0;
      const generate = jest.fn(async () => {
        calls += 1;
        return calls <= 2
          ? providerSuccess({
              text: '',
              finishReason: 'tool_calls' as const,
              toolCalls: [
                {
                  id: `page-call-${calls}`,
                  name: 'local-research-artifacts',
                  arguments: {
                    query: 'synthetic',
                    ...(calls === 2 ? { cursor: 'research-page-1' } : {}),
                  },
                },
              ],
            })
          : providerSuccess({
              text: JSON.stringify({
                type: 'result',
                value: {
                  answerKind: 'conversation',
                  answer: '어떤 점이 궁금하신가요?',
                },
                citations: [],
              }),
              finishReason: 'complete' as const,
              toolCalls: [],
            });
      });
      const provider = {
        ...f.selected.provider,
        capabilities: {
          ...f.selected.provider.capabilities,
          toolCalling: true,
        },
        generate,
        stream: undefined,
      };
      f.options.provider = provider;
      f.dependencies.selectedAi.mockResolvedValue({ ...f.selected, provider });
      const storage = createConversationArtifactStorage(db.database);
      const identity = {
        requestId: 'request',
        sessionId: 'session',
        sessionVersion: 0,
      };
      await storage.createSession('session', await storage.currentGeneration());
      await storage.startRequest({
        ...identity,
        id: 'request',
        question: f.options.request,
        createdAt: '2026-11-14T00:00:00.000Z',
      });
      let pause = () => {};
      let approvals = 0;
      f.authorize.mockImplementation(async () => {
        if (++approvals === 2) pause();
        return 'authorized';
      });
      const persisted = await storage.openWorkflowContinuation(
        identity,
        async input => ({
          ...(await captureColdRagConversationState({
            registry: f.registry,
            tracker: f.tracker,
            external: f.external,
            sessionId: 'session',
            operationRunId: 'run',
            options: f.options,
            signal: f.controller.signal,
            batches: input.evidenceBatches!,
            knownCallIds: input.knownCallIds,
            researchPaging: f.bundle.generated.researchPagingSnapshot!('run'),
          })),
          publicSearch: {
            version: 1,
            status: 'consent_required',
            charged: true,
          },
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
      const initial = await runContinuableConversationWorkflow(
        f.options,
        {},
        {
          persisted,
          bindPause: value => {
            pause = value;
          },
          waitForContinue: async () => false,
        },
      );
      expect(initial.status).toBe('paused');
      if (initial.status !== 'paused')
        throw new Error('Expected approval pause');
      const resumable = {
        ...f.options,
        operationJournal: persisted.operationJournal,
      };
      expect(
        isMultiAgentCheckpointResumable(initial.checkpoint, resumable),
      ).toBe(true);
      for (const patch of [
        ...(mode === 'populated' ? [] : [{ awaitingAuthorization: undefined }]),
        { awaitingAuthorization: 'model-99' },
        { pendingOperation: { kind: 'model', operationKey: 'model-2' } },
      ])
        expect(
          isMultiAgentCheckpointResumable(
            { ...initial.checkpoint, ...patch },
            resumable,
          ),
        ).toBe(false);
      expect(generate).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledTimes(1);
      const saved = await createConversationColdResumeStorage(db.database).open(
        identity,
      );
      expect(saved?.reconstruction.researchPaging).toEqual({
        version: 1,
        sequence: 1,
        tokens: [
          {
            token: 'research-page-1',
            query: 'synthetic',
            scope: 'run',
            cursor: expectedCursor,
          },
        ],
      });
      let coldPause = () => {};
      f.authorize.mockImplementation(async () => {
        if (mode !== 'complete' && generate.mock.calls.length === 2)
          coldPause();
        return 'authorized';
      });
      const turn = createConversationTurnRetention({
        storage,
        sessionId: 'session',
        turnId: 'request',
        sessionVersion: 0,
        createdAt: '2026-11-14T00:00:00.000Z',
        restored: true,
      });
      const resume = () =>
        resumeColdRagConversation({
          database: db.database,
          identity,
          dependencies: f.dependencies,
          signal: f.controller.signal,
          observer: {
            retentionRequestId: 'request',
            retentionSession: { id: 'session', version: 0 },
            onWorkflowPauseController: value => {
              coldPause = value;
            },
            onRetentionCandidate: turn.save,
          },
        });
      if (mode !== 'complete') {
        expect((await resume()).status).toBe('paused');
        expect(search).toHaveBeenCalledTimes(2);
        expect(generate).toHaveBeenCalledTimes(2);
        const again = await createConversationColdResumeStorage(
          db.database,
        ).open(identity);
        expect(again?.attempt).toBe(1);
        expect(again?.reconstruction.researchPaging).toEqual(
          saved?.reconstruction.researchPaging,
        );
        f.authorize.mockImplementation(async () => 'authorized');
      }
      const result = await resume();
      expect(result.status).toBe('completed');
      expect(generate).toHaveBeenCalledTimes(3);
      expect(search).toHaveBeenCalledTimes(2);
      expect(search.mock.calls.map(call => call[0].cursor)).toEqual([
        undefined,
        expectedCursor,
      ]);
      await expect(resume()).rejects.toThrow();
      expect(search).toHaveBeenCalledTimes(2);
      expect(f.search).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  },
);
