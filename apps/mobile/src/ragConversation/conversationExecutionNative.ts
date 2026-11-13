import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';
import type {
  ConversationExecutionAdapter,
  ConversationExecutionEvent,
} from './conversationExecutionLease';

type NativeExecution = {
  begin(requestId: string): Promise<boolean>;
  end(requestId: string): void;
  isActive(requestId: string): Promise<boolean>;
  protectedDataAvailable(): Promise<boolean>;
  addListener(event: string): void;
  removeListeners(count: number): void;
};

/** A missing bridge cannot promise execution or protected-data access. */
export function conversationExecutionNative(): ConversationExecutionAdapter | null {
  const module = NativeModules.ConversationExecutionModule as
    NativeExecution | undefined;
  if (Platform.OS !== 'ios' || !module) return null;
  const emitter = new NativeEventEmitter(module);
  return {
    begin: id => module.begin(id),
    end: id => module.end(id),
    isActive: id => module.isActive(id),
    protectedDataAvailable: () => module.protectedDataAvailable(),
    subscribe(listener) {
      const subscription = emitter.addListener(
        'ConversationExecutionChanged',
        (event: ConversationExecutionEvent) => listener(event),
      );
      const state = AppState.addEventListener('change', value => {
        if (value === 'active') listener({ kind: 'foreground' });
      });
      return () => {
        subscription.remove();
        state.remove();
      };
    },
  };
}
