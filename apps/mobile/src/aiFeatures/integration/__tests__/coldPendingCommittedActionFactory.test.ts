import { NativeModules } from 'react-native';
import { committedActionCrashSnapshot } from '../testSupport/committedActionCrashSnapshot';
import { openConversationRecovery } from '../../../storage/openConversationRecovery';
import { runCommittedActionConversationWorkflow } from '../../../ragConversation/runCommittedActionConversationWorkflow';
import {
  recoverConversationHealthHistory,
  recoverConversationHealthHistoryResult,
} from '../../../storage/recoverConversationHealthHistory';
import { openLocalStorage } from '../../../storage/secureDatabase';
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalStorage: jest.fn(),
}));
import { providerSuccess } from '@orot/model-runtime';
import { runMigrations, createRecordRepository } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { saveConversationHealthHistory } from '../../../storage/conversationHealthHistory';
import { runContinuableConversationWorkflow } from '../../../ragConversation/conversationWorkflowContinuation';
import { coldRagFactoryFixture } from '../testSupport/coldRagFactoryFixture';
import { conversationHistoryAction } from '../conversationHistoryAction';
import { captureColdRagConversationState } from '../coldRagConversationState';
import { restoreColdRagConversationFactory } from '../restoreColdRagConversationFactory';

// Real protected SQLite and LangGraph; all model output and history are synthetic.
test.each([true, false])(
  'recovers a committed action before its graph result checkpoint without another write, decision=%s',
  async allowed => {
    const originalNative = NativeModules.ConversationExecutionModule;
    NativeModules.ConversationExecutionModule = {
      processIdentity: async () => '11111111-1111-4111-8111-111111111111',
    };
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
      let restoreCrashCut: (() => Promise<void>) | undefined;
      const save = jest.fn(async (input, current) => {
        restoreCrashCut = await committedActionCrashSnapshot(db.database);
        return saveConversationHealthHistory(db.database, input, current);
      });
      f.local.data.saveConversationHistory = save;
      f.local.data.recoverConversationHistory = (input, current) =>
        recoverConversationHealthHistory(db.database, input, current);
      f.local.data.recoverConversationHistoryResult = (input, current) =>
        recoverConversationHealthHistoryResult(db.database, input, current);
      const observer = {
        retentionSession: { id: 'session', version: 0 },
        retentionRequestId: 'request',
        confirmHistorySave: jest.fn(async () => true),
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
      const live = await runContinuableConversationWorkflow(
        options,
        {},
        {
          persisted,
          bindPause: () => {},
          waitForContinue: async () => false,
        },
      );
      expect(live.status).toBe('result');
      expect(save).toHaveBeenCalledTimes(1);
      expect(
        (
          await db.database.execute(
            'SELECT status FROM conversation_action_recovery',
          )
        ).rows[0]?.status,
      ).toBe('committed');
      expect(restoreCrashCut).toBeDefined();
      await restoreCrashCut!();
      // The restored graph/journal is exactly the durable pre-write snapshot; the
      // separate domain transaction/receipt survived this simulated crash cut.
      expect(
        await openConversationRecovery(db.database, owner, signal),
      ).toBeUndefined();
      NativeModules.ConversationExecutionModule = {
        processIdentity: async () => '22222222-2222-4222-8222-222222222222',
      };
      const reopened = await openConversationRecovery(
        db.database,
        owner,
        signal,
      );
      expect(reopened?.actionRecovery).toBeDefined();
      const fresh = {
        ...observer,
        confirmHistorySave: jest.fn(async () => allowed),
      };
      const factory = await restoreColdRagConversationFactory({
        descriptor: reopened!.descriptor,
        dependencies: f.dependencies,
        observer: fresh,
        signal,
        readKnownCallIds: async () => [],
      });
      generate.mockClear();
      calls = 1;
      const resume = () =>
        runCommittedActionConversationWorkflow({
          database: db.database,
          descriptor: reopened!.descriptor,
          actionRecovery: reopened!.actionRecovery!,
          options: factory.options,
          invocation: { signal },
          validateSelection: factory.validateSelection,
          capture: async batches => ({
            ...(await factory.capture(batches)),
            completion,
          }),
        });
      if (allowed) expect((await resume()).status).toBe('result');
      else await expect(resume()).rejects.toThrow('could not be verified');
      expect(fresh.confirmHistorySave).toHaveBeenCalledTimes(1);
      expect(save).toHaveBeenCalledTimes(1);
      expect(generate).toHaveBeenCalledTimes(allowed ? 1 : 0);
      expect(
        (await db.database.execute('SELECT id FROM manual_history_entries'))
          .rows,
      ).toHaveLength(1);
      await expect(resume()).rejects.toThrow();
      expect(
        await openConversationRecovery(db.database, owner, signal),
      ).toBeUndefined();
      expect(save).toHaveBeenCalledTimes(1);
    } finally {
      NativeModules.ConversationExecutionModule = originalNative;
      db.close();
    }
  },
);
