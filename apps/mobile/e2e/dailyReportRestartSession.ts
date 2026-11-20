import { createDailyReportIdentity } from '@orot/domain';
import type { SqlDatabase } from '@orot/storage';
import { createDailyReportRequests } from '../src/aiFeatures/integration/dailyReportRequests';
import { dailyReportConversationFailure } from '../src/aiFeatures/integration/dailyReportConversationFailure';
import { createDailyReportStorage } from '../src/storage/dailyReportStorage';
import { createConversationArtifactStorage } from '../src/storage/conversationArtifactStorage';
import { createConversationSessionRetention } from '../src/ragConversation/conversationSessionRetention';
import type { ConversationSessionOptions } from '../src/ragConversation/conversationSessionTypes';
import type { ConversationScreenProps } from '../src/ragConversation/ConversationScreenProps';
import type { ConversationExecutionEvent } from '../src/ragConversation/conversationExecutionLease';
import {
  prepareReportDatabase,
  reportProvider,
  reportService,
} from '../src/aiFeatures/integration/testSupport/dailyReportFailureStageFixtures';

/** Synthetic lease and in-memory model only; the coordinator, generator and SQLite are real.
 * Counts distinguish the optional opening from facts-bearing report generation. No remote
 * resolver, credential store or real execution adapter is configured by this fixture. */
export async function createDailyReportRestartSession(database: SqlDatabase) {
  await prepareReportDatabase(database);
  const identity = createDailyReportIdentity('2035-01-01', 'UTC');
  let current = identity;
  let receive: ((event: ConversationExecutionEvent) => void) | undefined;
  let requestId = '';
  let sequence = 0;
  let releaseModel: (() => void) | undefined;
  let changed = () => {};
  const state = {
    send: 0,
    runs: 0,
    opening: 0,
    report: 0,
    scopePreserved: true,
    waiting: false,
    settled: 0,
    remote: 'not-configured',
  };
  const model = reportProvider();
  const generate = model.generate.bind(model);
  model.generate = async request => {
    const facts = request.messages.some(message => {
      if (!('content' in message)) return false;
      try {
        return Array.isArray(JSON.parse(message.content as string).facts);
      } catch {
        return false;
      }
    });
    if (facts) state.report += 1;
    else state.opening += 1;
    if (state.opening + state.report === 1) {
      state.waiting = true;
      changed();
      await new Promise<void>(resolve => {
        releaseModel = resolve;
      });
      state.waiting = false;
    }
    return generate(request);
  };
  const service = reportService(database, model, { remoteProcessing: true });
  const requests = createDailyReportRequests({
    currentIdentity: () => current,
    lookup: createDailyReportStorage(database).lookup,
    run: (requested, mode, signal, observer) => {
      state.runs += 1;
      changed();
      return service({
        timeZone: requested.timeZone,
        scope: {},
        mode,
        signal,
        observer,
      });
    },
  });
  const onSend: ConversationScreenProps['onSend'] = async (
    _question,
    _history,
    signal = new AbortController().signal,
    observer,
    entry,
  ) => {
    state.send += 1;
    state.scopePreserved &&=
      entry?.intent === 'daily-report' &&
      entry.reportRequest?.key === identity.key &&
      entry.reportRequest.timeZone === identity.timeZone;
    changed();
    if (!state.scopePreserved || signal.aborted)
      return { status: 'failure', kind: 'cancelled' };
    const operation = requests.start(
      identity,
      { kind: 'reuse_or_generate' },
      observer,
      signal,
    );
    if (operation.status !== 'started')
      return { status: 'failure', kind: 'unavailable' };
    const cancel = () => operation.cancel();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    try {
      const result = await operation.result;
      return result.status === 'failed'
        ? dailyReportConversationFailure(result.code)
        : {
            status: 'answer',
            answer: '합성 일일보고서 새 처리 완료',
            citations: [],
          };
    } finally {
      signal.removeEventListener('abort', cancel);
      state.settled += 1;
      changed();
    }
  };
  const artifactStorage = createConversationArtifactStorage(database);
  const options: ConversationSessionOptions = {
    retention: createConversationSessionRetention({
      openStorage: async () => artifactStorage,
      createId: () => `synthetic-restart-${++sequence}`,
      now: () => '2035-01-01T12:00:00.000Z',
    }),
    execution: {
      begin: async id => {
        requestId = id;
        return true;
      },
      end: () => {},
      isActive: async () => true,
      protectedDataAvailable: async () => true,
      subscribe: listener => {
        receive = listener;
        return () => {
          receive = undefined;
        };
      },
    },
  };
  return {
    identity,
    options,
    onSend,
    snapshot: () => ({ ...state }),
    subscribe(listener: () => void) {
      changed = listener;
      return () => {
        changed = () => {};
      };
    },
    nextDay() {
      current = createDailyReportIdentity('2035-01-02', 'UTC');
      changed();
    },
    interrupt() {
      if (!state.waiting || !requestId)
        throw new Error('Synthetic model has not started');
      receive?.({ kind: 'expired', requestId });
      releaseModel?.();
    },
    dispose() {
      requests.active(identity)?.cancel();
      releaseModel?.();
      changed = () => {};
    },
  };
}
