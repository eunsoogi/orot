import { NativeEventEmitter, NativeModules } from 'react-native';

type RootURLModule = {
  peek(): Promise<unknown>;
  acknowledge(id: string): Promise<void>;
  addListener(event: string): void;
  removeListeners(count: number): void;
};

function native(): RootURLModule {
  const module = NativeModules.RootURLModule as RootURLModule | undefined;
  if (!module) throw new Error('Root URL inbox is unavailable');
  return module;
}

/** Native events are wake signals; the peek/ack inbox owns delivery identity. */
export const rootURLBridge = {
  peek: () => native().peek(),
  acknowledge: (id: string) => native().acknowledge(id),
  subscribe(listener: () => void) {
    const subscription = new NativeEventEmitter(native()).addListener(
      'rootURLOpened',
      listener,
    );
    return () => subscription.remove();
  },
};
