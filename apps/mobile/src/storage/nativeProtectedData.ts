import {
  AppState,
  NativeEventEmitter,
  NativeModules,
  Platform,
} from 'react-native';

type NativeProtectedData = {
  protectedDataAvailable(): Promise<boolean>;
  addListener(event: string): void;
  removeListeners(count: number): void;
};

/** Expose only the existing iOS protected-data signal to storage. This bridge
 * does not grant database access or allow Conversation execution requests. */
export function createNativeProtectedDataWitness() {
  const module = NativeModules.ConversationExecutionModule as
    NativeProtectedData | undefined;
  if (Platform.OS !== 'ios' || !module) return null;
  const emitter = new NativeEventEmitter(module);

  return {
    isForeground: () => AppState.currentState === 'active',
    async confirmAvailable() {
      try {
        return (await module.protectedDataAvailable()) === true;
      } catch {
        return false;
      }
    },
    // A positive or unrelated execution event cannot re-admit a stopped read.
    subscribeToLoss(onLoss: () => void) {
      const protection = emitter.addListener(
        'ConversationExecutionChanged',
        (event: { kind?: unknown; available?: unknown } | null) => {
          if (
            event &&
            typeof event === 'object' &&
            event.kind === 'protectedData' &&
            event.available === false
          )
            onLoss();
        },
      );
      const phase = AppState.addEventListener('change', value => {
        if (value !== 'active') onLoss();
      });
      return () => {
        protection.remove();
        phase.remove();
      };
    },
  };
}
