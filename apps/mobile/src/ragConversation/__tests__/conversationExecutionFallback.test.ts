import { AppState, NativeEventEmitter, NativeModules } from 'react-native';
import { conversationExecutionNative } from '../conversationExecutionNative';
import { beginConversationExecutionLease } from '../conversationExecutionLease';

test('a missing iOS bridge interrupts on background instead of claiming an extension', async () => {
  expect(NativeModules.ConversationExecutionModule).toBeUndefined();
  let change:
    ((value: import('react-native').AppStateStatus) => void) | undefined;
  const remove = jest.fn();
  const subscribe = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((_event, callback) => {
      change = callback;
      return { remove };
    });
  try {
    const adapter = conversationExecutionNative()!;
    const interrupt = jest.fn();
    const end = await beginConversationExecutionLease(
      adapter,
      'request',
      interrupt,
    );
    expect(await adapter.protectedDataAvailable()).toBeNull();
    change!('background');
    expect(interrupt).toHaveBeenCalledWith('expired');
    end();
    expect(remove).toHaveBeenCalled();
  } finally {
    subscribe.mockRestore();
  }
});

test('native execution events are forwarded only when their payload is valid', () => {
  NativeModules.ConversationExecutionModule = {
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  };
  let emit: ((value: object) => void) | undefined;
  const subscription = jest
    .spyOn(NativeEventEmitter.prototype, 'addListener')
    .mockImplementation((_name, callback) => {
      emit = callback;
      return { remove: jest.fn() };
    });
  const listener = jest.fn();
  const state = jest
    .spyOn(AppState, 'addEventListener')
    .mockReturnValue({ remove: jest.fn() });
  try {
    const unsubscribe = conversationExecutionNative()!.subscribe(listener);
    emit!({ kind: 'expired', requestId: 'request' });
    emit!({ kind: 'protectedData', available: false });
    emit!({ kind: 'expired', requestId: 12 });
    emit!({ kind: 'protectedData', available: 'false' });
    expect(listener.mock.calls).toEqual([
      [{ kind: 'expired', requestId: 'request' }],
      [{ kind: 'protectedData', available: false }],
    ]);
    unsubscribe();
  } finally {
    subscription.mockRestore();
    state.mockRestore();
    delete NativeModules.ConversationExecutionModule;
  }
});
