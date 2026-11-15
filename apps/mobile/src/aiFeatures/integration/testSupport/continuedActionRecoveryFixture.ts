import { providerSuccess } from '@orot/model-runtime';
import { runMigrations, createRecordRepository } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { openLocalStorage } from '../../../storage/secureDatabase';
import { createConversationArtifactStorage } from '../../../storage/conversationArtifactStorage';
import { saveConversationHealthHistory } from '../../../storage/conversationHealthHistory';
import {
  recoverConversationHealthHistory,
  recoverConversationHealthHistoryResult,
} from '../../../storage/recoverConversationHealthHistory';
import { openConversationRecovery } from '../../../storage/openConversationRecovery';
import { runCommittedActionConversationWorkflow } from '../../../ragConversation/runCommittedActionConversationWorkflow';
import { runContinuableConversationWorkflow } from '../../../ragConversation/conversationWorkflowContinuation';
import { committedActionCrashSnapshot } from './committedActionCrashSnapshot';
import { coldRagFactoryFixture } from './coldRagFactoryFixture';
import { retainedActionSources } from './retainedActionSources';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import { conversationHistoryAction } from '../conversationHistoryAction';
import { captureColdRagConversationState } from '../coldRagConversationState';
import { restoreColdRagConversationFactory } from '../restoreColdRagConversationFactory';

/** Actual SQLite and SDK workflow with synthetic providers and a controllable crash cut. */
export async function continuedActionRecoveryFixture() {
  const db = openSqliteTestDatabase(':memory:');
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
  const prior = await retainedActionSources(db.database);
  await storage.startRequest({
    id: 'request',
    sessionId: 'session',
    sessionVersion: 0,
    question,
    createdAt: '2026-11-15T00:00:00.000Z',
  });
  const search = { version: 1, status: 'consent_required', charged: true };
  const f = await coldRagFactoryFixture(
    search as Parameters<typeof coldRagFactoryFixture>[0],
    data => {
      data.conversationArtifactDiscovery = async registry =>
        createConversationArtifactDiscovery({
          database: db.database,
          storage,
          registry,
          data,
        });
    },
  );
  const signal = new AbortController().signal;
  f.local.data.openConversationArtifactStorage = async () => storage;
  Object.assign(f.local.data, {
    manualHistory: createRecordRepository(db.database).manualHistory,
  });
  let crash: (() => Promise<void>) | undefined;
  const save = jest.fn(async (input, current) => {
    crash = await committedActionCrashSnapshot(db.database);
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
    retainedHistory: [...prior],
    confirmHistorySave: jest.fn(async () => true),
  };
  let plan: string[] = [];
  let ordinal = 0;
  const generate = jest.fn(async () => {
    const next = plan.shift();
    return next
      ? providerSuccess({
          text: '',
          finishReason: 'tool_calls' as const,
          toolCalls: [
            {
              id: `new-action-${++ordinal}`,
              name: 'save-past-health-history',
              arguments: { userMessage: next },
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
      admittedQuestions: prior.map(value => value.question),
    }),
  };
  const completion = {
    version: 1,
    entryContext: null,
    priorDialogue: prior.map(value => ({
      question: value.question,
      answer: value.answer,
    })),
    priorUserReports: [],
    historySources: [],
    reportReferences: [],
    localRetrievalFailed: false,
  };
  const capture = async (input: {
    knownCallIds: readonly string[];
    evidenceBatches?: readonly import('@orot/agent-runtime').EvidenceBatch[];
  }) => ({
    publicSearch: search,
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
  const open = () => openConversationRecovery(db.database, owner, signal);
  return {
    db,
    question,
    prior,
    save,
    generate,
    observer,
    open,
    plan(messages: string[]) {
      plan = messages;
    },
    async crash() {
      if (!crash) throw new Error('Missing synthetic cut');
      await crash();
    },
    async live() {
      const persisted = await storage.openWorkflowContinuation(owner, capture);
      return runContinuableConversationWorkflow(
        options,
        {},
        { persisted, bindPause: () => {}, waitForContinue: async () => false },
      );
    },
    async recover(
      confirmHistorySave = jest.fn(async () => true),
      recoverySignal = signal,
    ) {
      const reopened = await open();
      if (!reopened?.actionRecovery) throw new Error('No committed recovery');
      const factory = await restoreColdRagConversationFactory({
        descriptor: reopened.descriptor,
        dependencies: f.dependencies,
        observer: { ...observer, confirmHistorySave },
        signal: recoverySignal,
        readKnownCallIds: async () => [],
      });
      return runCommittedActionConversationWorkflow({
        database: db.database,
        descriptor: reopened.descriptor,
        actionRecovery: reopened.actionRecovery,
        options: factory.options,
        invocation: { signal: recoverySignal },
        validateSelection: factory.validateSelection,
        capture: async batches => ({
          ...(await factory.capture(batches)),
          completion,
        }),
      });
    },
  };
}
