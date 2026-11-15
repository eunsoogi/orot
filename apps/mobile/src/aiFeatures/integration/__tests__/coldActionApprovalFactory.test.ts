import { openLocalStorage } from '../../../storage/secureDatabase';
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));
import { providerSuccess } from '@orot/model-runtime';
import { runMigrations, createRecordRepository } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { saveConversationHealthHistory } from '../../../storage/conversationHealthHistory';
import { createConversationColdResumeStorage } from '../../../storage/conversationColdResumeStorage';
import { runContinuableConversationWorkflow } from '../../../ragConversation/conversationWorkflowContinuation';
import { runColdConversationWorkflow } from '../../../ragConversation/runColdConversationWorkflow';
import { coldRagFactoryFixture } from '../testSupport/coldRagFactoryFixture';
import { conversationHistoryAction } from '../conversationHistoryAction';
import { captureColdRagConversationState } from '../coldRagConversationState';
import { restoreColdRagConversationFactory } from '../restoreColdRagConversationFactory';

// Real protected SQLite and LangGraph; all model output and history are synthetic.
test.each([true, false])(
  'restores a paused action approval with a fresh decision=%s',
  async allowed => {
    const db = openSqliteTestDatabase(':memory:');
    try {
      await runMigrations(db.database);
      jest
        .mocked(openLocalStorage)
        .mockResolvedValue(createRecordRepository(db.database));
      const storage = createConversationArtifactStorage(db.database);
      await storage.createSession('session', await storage.currentGeneration());
      const owner = {
        requestId: 'request',
        sessionId: 'session',
        sessionVersion: 0,
      };
      const question = '작년에 수술을 받은 것 같아요.';
      await storage.startRequest({
        id: 'request',
        sessionId: 'session',
        sessionVersion: 0,
        question,
        createdAt: '2026-11-15T00:00:00.000Z',
      });
      const f = await coldRagFactoryFixture({
        version: 1,
        status: 'consent_required',
        charged: true,
      });
      const signal = new AbortController().signal;
      f.local.data.openConversationArtifactStorage = async () => storage;
      Object.assign(f.local.data, {
        manualHistory: createRecordRepository(db.database).manualHistory,
      });
      const save = jest.fn((input, current) =>
        saveConversationHealthHistory(db.database, input, current),
      );
      f.local.data.saveConversationHistory = save;
      let pause = () => {};
      let lateDecision: ((value: boolean) => void) | undefined;
      const observer = {
        retentionSession: { id: 'session', version: 0 },
        retentionRequestId: 'request',
        confirmHistorySave: jest.fn(
          () =>
            new Promise<boolean>(resolve => {
              lateDecision = resolve;
              pause();
            }),
        ),
      };
      let calls = 0;
      const generate = jest.fn(async () => {
        calls++;
        return calls === 1
          ? providerSuccess({
              text: '',
              finishReason: 'tool_calls' as const,
              toolCalls: [
                {
                  id: 'action-call',
                  name: 'save-past-health-history',
                  arguments: { userMessage: question },
                },
              ],
            })
          : providerSuccess({
              text: JSON.stringify({
                type: 'result',
                value: { answerKind: 'conversation', answer: '확인했습니다.' },
                citations: [],
              }),
              finishReason: 'complete' as const,
              toolCalls: [],
            });
      });
      const provider = { ...f.selected.provider, generate, stream: undefined };
      f.dependencies.selectedAi.mockResolvedValue({ ...f.selected, provider });
      const options = {
        ...f.options,
        provider,
        request: question,
        initialSearch: undefined,
        actions: conversationHistoryAction({
          data: f.local.data,
          registry: f.registry,
          observer,
          question,
          admittedQuestions: [],
        }),
      };
      const completion = {
        version: 1,
        entryContext: null,
        priorDialogue: [],
        priorUserReports: [],
        historySources: [],
        reportReferences: [],
        localRetrievalFailed: false,
      };
      const capture = async (input: {
        knownCallIds: readonly string[];
        evidenceBatches?: readonly import('@orot/agent-runtime').EvidenceBatch[];
      }) => ({
        publicSearch: { version: 1, status: 'consent_required', charged: true },
        completion,
        ...(await captureColdRagConversationState({
          registry: f.registry,
          tracker: f.tracker,
          external: f.external,
          sessionId: 'session',
          operationRunId: 'run',
          knownCallIds: input.knownCallIds,
          batches: input.evidenceBatches!,
          options,
          signal,
        })),
      });
      const persisted = await storage.openWorkflowContinuation(owner, capture);
      const paused = await runContinuableConversationWorkflow(
        options,
        {},
        {
          persisted,
          bindPause: next => {
            pause = next;
          },
          waitForContinue: async () => false,
        },
      );
      expect(paused.status).toBe('paused');
      lateDecision?.(true);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(generate).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
      const saved = await createConversationColdResumeStorage(db.database).open(
        owner,
      );
      expect(saved).toBeDefined();
      const fresh = {
        ...observer,
        confirmHistorySave: jest.fn(async () => allowed),
      };
      await expect(
        restoreColdRagConversationFactory({
          descriptor: saved!,
          dependencies: f.dependencies,
          observer: { ...fresh, retentionRequestId: 'another-request' },
          signal,
          readKnownCallIds: async () => [],
        }),
      ).rejects.toThrow('Cold action ownership changed.');
      expect(generate).toHaveBeenCalledTimes(1);
      expect(fresh.confirmHistorySave).not.toHaveBeenCalled();
      const factory = await restoreColdRagConversationFactory({
        descriptor: saved!,
        dependencies: f.dependencies,
        observer: fresh,
        signal,
        readKnownCallIds: async () => [],
      });
      expect(fresh.confirmHistorySave).not.toHaveBeenCalled();
      const result = await runColdConversationWorkflow({
        database: db.database,
        descriptor: saved!,
        options: factory.options,
        invocation: { signal },
        validateSelection: factory.validateSelection,
        capture: factory.capture,
      });
      expect(result.status).toBe(allowed ? 'result' : 'consent_required');
      expect(fresh.confirmHistorySave).toHaveBeenCalledTimes(1);
      expect(observer.confirmHistorySave).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(
        (await db.database.execute('SELECT id FROM manual_history_entries'))
          .rows,
      ).toHaveLength(allowed ? 1 : 0);
      await expect(
        runColdConversationWorkflow({
          database: db.database,
          descriptor: saved!,
          options: factory.options,
          invocation: { signal },
          validateSelection: factory.validateSelection,
          capture: factory.capture,
        }),
      ).rejects.toThrow();
      expect(save).toHaveBeenCalledTimes(allowed ? 1 : 0);
    } finally {
      db.close();
    }
  },
);
