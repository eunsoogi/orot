import { createConversationRequestLifetime } from '../conversationRequestLifetime';
import { ownsOutcome } from '../conversationOutcomeOwnership';
import { createConversationTurnRetention } from '../conversationTurnRetention';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import { createConversationArtifactStorage } from '../../storage/conversationArtifactStorage';
import { observeConversationProviderExecution } from '../../aiFeatures/integration/observeConversationProviderExecution';
import type { LanguageModelProvider } from '@orot/model-runtime';

/** System progress must follow real request ownership and durable completion, not a timer. */
test('milestones fence stopped and superseded requests and distinguish received from saved', async () => {
  const milestone = jest.fn();
  const reportStatus = jest.fn();
  const execution = {
    reportStatus,
    work: jest.fn(),
    currentPhase: () => 'active' as const,
    begin: async () => true,
    end: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
    milestone,
  };
  const turn = {
    toolMessageId: 'synthetic-turn',
    startRequest: async () => {},
    interruptRequest: async () => {},
  } as unknown as ReturnType<typeof createConversationTurnRetention>;
  const lifetime = createConversationRequestLifetime({
    execution,
    interrupt: jest.fn(),
    reportFenceFailure: jest.fn(),
  });
  const controller = new AbortController();
  await lifetime.start(1, controller, turn, 'synthetic question');
  lifetime.answered(controller, false);
  expect(milestone.mock.calls).toEqual([
    ['synthetic-turn:lease:1:1', 'answered'],
  ]);
  lifetime.answered(controller, true);
  expect(milestone.mock.calls.at(-1)).toEqual([
    'synthetic-turn:lease:1:1',
    'committed',
  ]);
  lifetime.interrupt(1, 'interrupted');
  const count = milestone.mock.calls.length;
  lifetime.answered(controller, true);
  expect(milestone).toHaveBeenCalledTimes(count);
  await lifetime.settle(1, controller);
  expect(execution.end).toHaveBeenCalledTimes(1);
  lifetime.answered(controller, true);
  expect(milestone).toHaveBeenCalledTimes(count);
  const old = new AbortController();
  await lifetime.start(2, old, turn, 'old');
  const previous = lifetime.executionObserver(old);
  const late = previous.onProviderExecution?.();
  const newer = new AbortController();
  await lifetime.start(2, newer, turn, 'new');
  const beforeLate = reportStatus.mock.calls.length;
  late?.();
  previous.onProviderExecution?.();
  expect(reportStatus).toHaveBeenCalledTimes(beforeLate);
  lifetime.answered(old, true);
  expect(milestone).toHaveBeenCalledTimes(count);
  await lifetime.settle(2, old);
  await lifetime.settle(2, newer);
});

test('a committed old answer never replaces a new controller owner', () => {
  expect(ownsOutcome(false, false, { committed: true })).toBe(false);
  expect(ownsOutcome(false, true, { committed: true })).toBe(true);
  expect(ownsOutcome(false, true, { summaryCommitted: true })).toBe(true);
  expect(ownsOutcome(false, true, {})).toBe(false);
  expect(ownsOutcome(true, true, {})).toBe(true);
});

function deferred<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

const event = (
  status: ConversationToolEvent['status'],
  callId = 'safe',
): ConversationToolEvent => ({
  version: 1,
  operationRunId: 'synthetic-run',
  callId,
  toolName: 'local-evidence',
  order: 1,
  status,
  inputSummary: { sourceKind: 'personal_record' },
  sources: [],
});

test('one protected turn reports real tool and model stages without counting waiting or stale ownership', async () => {
  jest.useFakeTimers();
  const db = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(db.database);
    const storage = createConversationArtifactStorage(db.database);
    await storage.createSession('session', await storage.currentGeneration());
    let interrupt!: (
      e: import('../conversationExecutionLease').ConversationExecutionEvent,
    ) => void;
    const reportStatus = jest.fn();
    const milestone = jest.fn();
    let phase: 'active' | 'background' = 'active';
    const work = jest.fn();
    const end = jest.fn();
    const begin = jest.fn(async () => true);
    const now = '2026-01-02T03:04:00.000Z';
    const realStart = storage.startRequest.bind(storage);
    const gate = deferred<void>();
    const started = deferred<void>();
    const turn = createConversationTurnRetention({
      sessionId: 'session',
      sessionVersion: 0,
      createdAt: now,
      turnId: 'owned',
      storage: {
        ...storage,
        async startRequest(input) {
          started.release();
          await gate.promise;
          return realStart(input);
        },
      },
    });
    const lifetime = createConversationRequestLifetime({
      execution: {
        begin,
        end,
        work,
        milestone,
        reportStatus,
        currentPhase: () => phase,
        isActive: async () => true,
        protectedDataAvailable: async () => true,
        subscribe(listener) {
          interrupt = listener;
          return () => {};
        },
      },
      interrupt: id => lifetime.interrupt(id, 'interrupted'),
      reportFenceFailure: jest.fn(),
    });
    const controller = new AbortController();
    const attaching = lifetime.start(1, controller, turn, 'synthetic prompt');
    await started.promise;
    expect(reportStatus).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
    gate.release();
    await attaching;
    const id = 'owned:lease:1:1';
    const stages = () =>
      reportStatus.mock.calls.map(([owner, stage]) => {
        expect(owner).toBe(id);
        return stage;
      });
    expect(stages()).toEqual(['checkpointed']);
    const owner = lifetime.executionObserver(controller);
    owner.onBackgroundTool?.(event('started'));
    owner.onAcceptedSearch?.(event('started', 'other-call'));
    owner.onBackgroundTool?.(event('completed'));
    owner.onBackgroundTool?.(event('started', 'next'));
    owner.onAcceptedSearch?.(event('started', 'next'));
    owner.onBackgroundTool?.(event('completed', 'next'));
    owner.onBackgroundTool?.(event('completed', 'next'));
    owner.onBackgroundTool?.(event('started', 'cancel'));
    owner.onBackgroundTool?.(event('cancelled', 'cancel'));
    expect(stages()).toEqual([
      'checkpointed',
      'tool_started',
      'tool_finished',
      'tool_started',
      'tool_completed',
      'tool_started',
      'tool_cancelled',
    ]);

    const model = (generate: () => unknown) =>
      observeConversationProviderExecution(
        { generate } as unknown as LanguageModelProvider,
        owner.onProviderExecution,
      ).generate({} as never);
    const finished = ['provider_waiting', 'provider_finished'];
    await model(() => 'synthetic result');
    expect(stages().slice(-2)).toEqual(finished);
    expect(jest.getTimerCount()).toBe(0);
    await expect(
      model(() => {
        throw new Error('synthetic synchronous error');
      }),
    ).rejects.toThrow('synthetic synchronous error');
    expect(stages().slice(-2)).toEqual(finished);
    expect(jest.getTimerCount()).toBe(0);
    const pending = deferred<void>();
    const generate = jest.fn(() => pending.promise);
    const providerResult = model(generate);
    expect(stages().at(-1)).toBe('provider_waiting');
    phase = 'background';
    interrupt({ kind: 'phase' });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(stages().filter(stage => stage === 'provider_waiting')).toHaveLength(
      5,
    );
    interrupt({ kind: 'expired', requestId: id });
    const afterExpiry = stages();
    await jest.advanceTimersByTimeAsync(60_000);
    owner.onBackgroundTool?.(event('started', 'late'));
    pending.release();
    await providerResult;
    expect(stages()).toEqual(afterExpiry);
    expect(jest.getTimerCount()).toBe(0);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(
      work.mock.calls.filter(([, active]) => active === true),
    ).toHaveLength(1);
    expect(milestone).not.toHaveBeenCalled();
    await lifetime.settle(1, controller);
    expect(end).toHaveBeenCalledWith(id);
    expect(
      (await storage.listInterruptedRequests('session', 0)).map(row => [
        row.id,
        row.interruptionReason,
      ]),
    ).toEqual([['owned', 'expired']]);
  } finally {
    db.close();
    jest.useRealTimers();
  }
});
