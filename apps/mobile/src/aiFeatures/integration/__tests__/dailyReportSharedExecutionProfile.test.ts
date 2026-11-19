import { createConversationRequestLifetime } from '../../../ragConversation/conversationRequestLifetime';
import type { createConversationTurnRetention } from '../../../ragConversation/conversationTurnRetention';
import { createDailyReportIdentity } from '@orot/domain';
import { providerSuccess } from '@orot/model-runtime';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { createDailyReportRequests } from '../dailyReportRequests';
import { conversationBackgroundProvider } from '../conversationBackgroundProvider';

/** Synthetic dispatch, no network: distinguish receipt joining from OS execution ownership. */
test('joining a running daily report observes its actual remote execution without redispatch', async () => {
  const identity = createDailyReportIdentity('2035-01-01', 'UTC')!;
  let finish!: () => void;
  const provider = {
    kind: 'language-model',
    id: 'synthetic',
    capabilities: {},
    generate: jest.fn(async () => {
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return providerSuccess({
        text: 'synthetic',
        toolCalls: [],
        finishReason: 'complete',
      });
    }),
  } as unknown as LanguageModelProvider;
  const requests = createDailyReportRequests({
    lookup: jest.fn(),
    currentIdentity: () => identity,
    run: async (_identity, _mode, signal, observer) => {
      const wrapped = conversationBackgroundProvider(provider, true, remote =>
        observer?.onExecutionState?.(remote ? 'working' : 'local'),
      );
      await wrapped.generate({ messages: [] }, { signal });
      return { status: 'failed', code: 'cancelled' };
    },
  });
  const original = { onExecutionState: jest.fn() };
  const work = jest.fn();
  const lifetime = createConversationRequestLifetime({
    execution: {
      begin: async () => true,
      end: jest.fn(),
      isActive: async () => true,
      protectedDataAvailable: async () => true,
      subscribe: () => () => {},
      currentPhase: () => 'active',
      work,
    },
    interrupt: jest.fn(),
    reportFenceFailure: jest.fn(),
  });
  const controller = new AbortController();
  await lifetime.start(
    2,
    controller,
    {
      toolMessageId: 'synthetic-joined',
      startRequest: async () => {},
      interruptRequest: async () => {},
    } as unknown as ReturnType<typeof createConversationTurnRetention>,
    'synthetic',
  );
  const executionObserver = lifetime.executionObserver(controller);
  const joined = {
    onExecutionState: jest.fn(executionObserver.onExecutionState),
  };
  const first = requests.start(
    identity,
    { kind: 'reuse_or_generate' },
    original,
  );
  await Promise.resolve();
  const second = requests.start(
    identity,
    { kind: 'reuse_or_generate' },
    joined,
  );
  try {
    expect(first.status).toBe('started');
    expect(second.status).toBe('started');
    expect(original.onExecutionState).toHaveBeenCalledWith('working');
    expect(joined.onExecutionState).toHaveBeenCalledWith('working');
    expect(provider.generate).toHaveBeenCalledTimes(1);
    expect(work).toHaveBeenCalledWith('synthetic-joined:lease:2:1', true);
  } finally {
    finish();
    if (first.status === 'started') await first.result;
    await lifetime.settle(2, controller);
  }
});
