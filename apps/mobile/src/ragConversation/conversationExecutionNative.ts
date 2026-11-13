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

/** Without the bridge, stop at background entry rather than claim an iOS execution extension. */
export function conversationExecutionNative(): ConversationExecutionAdapter | null {
  const module = NativeModules.ConversationExecutionModule as
    NativeExecution | undefined;
  if (Platform.OS !== 'ios') return null;
  if (!module) return backgroundInterruptFallback();
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

function backgroundInterruptFallback(): ConversationExecutionAdapter {
  const active = new Set<string>();
  let background = AppState.currentState === 'background';
  return {
    async begin(id) {
      if (background) return false;
      active.add(id);
      return true;
    },
    end: id => {
      active.delete(id);
    },
    isActive: async id => !background && active.has(id),
    // The bridge is unavailable, so protected-data state is unknown; storage still enforces access.
    protectedDataAvailable: async () => null,
    subscribe(listener) {
      const subscription = AppState.addEventListener('change', state => {
        background = state === 'background';
        if (background)
          for (const requestId of active)
            listener({ kind: 'expired', requestId });
        else if (state === 'active') listener({ kind: 'foreground' });
      });
      return () => subscription.remove();
    },
  };
}
