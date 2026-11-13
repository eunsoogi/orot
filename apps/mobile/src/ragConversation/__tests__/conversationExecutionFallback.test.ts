import { AppState, NativeModules } from 'react-native';
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
