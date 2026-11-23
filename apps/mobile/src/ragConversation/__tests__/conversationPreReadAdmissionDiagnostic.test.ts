import { NativeModules } from 'react-native';
import type { ConversationExecutionAdapter } from '../conversationExecutionLease';
import { createConversationRequestLifetime } from '../conversationRequestLifetime';

function held<T>() {
  let release!: (value: T) => void;
  const result = new Promise<T>(resolve => {
    release = resolve;
  });
  return { result, release };
}

const nativeBefore = NativeModules.OrotProviderDiagnostics;
const report = jest.fn();
beforeEach(() => {
  report.mockClear();
  NativeModules.OrotProviderDiagnostics = { enabled: true, report };
});
afterEach(() => {
  NativeModules.OrotProviderDiagnostics = nativeBefore;
});

function setup(test: 'success' | 'stop' | 'write-error') {
  const controller = new AbortController();
  const write = held<void>();
  const entered = held<void>();
  const begin = held<boolean>();
  const native: ConversationExecutionAdapter = {
    bridgeAvailable: true,
    currentPhase: () => 'active',
    begin: jest.fn(() => {
      entered.release();
      return begin.result;
    }),
    end: jest.fn(),
    isActive: async () => true,
    protectedDataAvailable: async () => true,
    subscribe: () => () => {},
  };
  const owner = createConversationRequestLifetime({
    execution: native,
    interrupt: () => controller.abort(),
    reportFenceFailure: jest.fn(),
  });
  const error = new Error('Synthetic private error sentinel');
  const turn = {
    toolMessageId: 'synthetic-private-turn',
    startRequest: jest.fn(() => {
      if (test === 'write-error') throw error;
      return write.result;
    }),
  } as unknown as Parameters<typeof owner.start>[2];
  const dispatch = jest.fn();
  return {
    controller,
    write,
    entered,
    begin,
    native,
    owner,
    turn,
    error,
    dispatch,
    start: () =>
      owner
        .start(9, controller, turn, 'Synthetic content sentinel')
        .then(() => {
          if (!controller.signal.aborted) dispatch();
        }),
  };
}

test('brackets held protected write and native lease separately before dispatch', async () => {
  const f = setup('success');
  const pending = f.start();
  expect(report.mock.calls).toEqual([
    ['rag', 'conversation_request_write_wait', 'started'],
  ]);
  expect(f.native.begin).not.toHaveBeenCalled();
  expect(f.dispatch).not.toHaveBeenCalled();
  f.write.release();
  await f.entered.result;
  expect(report.mock.calls).toEqual([
    ['rag', 'conversation_request_write_wait', 'started'],
    ['rag', 'conversation_request_write_wait', 'completed'],
    ['rag', 'conversation_lease_admission_wait', 'started'],
  ]);
  expect(f.dispatch).not.toHaveBeenCalled();
  f.begin.release(true);
  await pending;
  expect(f.dispatch).toHaveBeenCalledTimes(1);
  expect(report.mock.calls).toEqual([
    ['rag', 'conversation_request_write_wait', 'started'],
    ['rag', 'conversation_request_write_wait', 'completed'],
    ['rag', 'conversation_lease_admission_wait', 'started'],
    ['rag', 'conversation_lease_admission_wait', 'completed'],
  ]);
});

test('Stop during the write does not emit lease admission or start dispatch', async () => {
  const f = setup('stop');
  const pending = f.start();
  f.controller.abort();
  f.write.release();
  await pending;
  expect(f.native.begin).not.toHaveBeenCalled();
  expect(f.dispatch).not.toHaveBeenCalled();
  expect(report.mock.calls).toEqual([
    ['rag', 'conversation_request_write_wait', 'started'],
    ['rag', 'conversation_request_write_wait', 'cancelled'],
  ]);
});

test('write failure preserves the exact error and never logs its message', async () => {
  const f = setup('write-error');
  await expect(f.start()).rejects.toBe(f.error);
  expect(f.dispatch).not.toHaveBeenCalled();
  expect(report.mock.calls).toEqual([
    ['rag', 'conversation_request_write_wait', 'started'],
    ['rag', 'conversation_request_write_wait', 'failed'],
  ]);
});

test('native refusal does not become a dispatch, and opt-out emits no markers', async () => {
  NativeModules.OrotProviderDiagnostics = { enabled: false, report };
  const f = setup('success');
  const pending = f.start();
  f.write.release();
  await f.entered.result;
  f.begin.release(false);
  await pending;
  expect(f.dispatch).not.toHaveBeenCalled();
  expect(report).not.toHaveBeenCalled();
});
