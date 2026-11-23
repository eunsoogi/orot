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
  beginPreparation?(attemptId: string): Promise<boolean>;
  end(requestId: string): void;
  work?(requestId: string, active: boolean): void;
  answered?(requestId: string): void;
  reportStatus?(
    requestId: string,
    stage:
      | import('./conversationBackgroundStatus').ConversationBackgroundStage
      | 'answered',
  ): void;
  committed?(requestId: string): void;
  isActive(requestId: string): Promise<boolean>;
  isPauseCurrent?(requestId: string, warning: string): Promise<boolean>;
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
    bridgeAvailable: true,
    currentPhase,
    begin: id => module.begin(id),
    ...(typeof module.beginPreparation === 'function'
      ? {
          beginPreparation: async (id: string) =>
            (await module.beginPreparation?.(id)) === true,
        }
      : {}),
    end: id => module.end(id),
    work: (id, active) => module.work?.(id, active),
    ...(typeof module.reportStatus === 'function'
      ? { reportStatus: (id, stage) => module.reportStatus?.(id, stage) }
      : {}),
    milestone: (id, stage) => {
      if (stage === 'answered' && module.reportStatus)
        module.reportStatus(id, stage);
      else module[stage]?.(id);
    },
    isActive: id => module.isActive(id),
    pauseStillCurrent: async (id, warning) =>
      (await module.isPauseCurrent?.(id, warning)) === true,
    protectedDataAvailable: () => module.protectedDataAvailable(),
    subscribe(listener) {
      const subscription = emitter.addListener(
        'ConversationExecutionChanged',
        (value: object) => {
          // Native events are untrusted across the bridge; ignore malformed payloads.
          if (!value || typeof value !== 'object') return;
          const event = value as Partial<ConversationExecutionEvent>;
          if (
            event.kind === 'continued' &&
            typeof event.requestId === 'string' &&
            (event.state === 'continued-granted' ||
              event.state === 'continued-refused' ||
              event.state === 'continued-deferred-inactive')
          )
            listener({
              kind: 'continued',
              requestId: event.requestId,
              state: event.state,
            });
          else if (
            event.kind === 'pause-requested' &&
            typeof event.requestId === 'string' &&
            typeof event.warning === 'string' &&
            /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(event.warning)
          )
            listener({
              kind: 'pause-requested',
              requestId: event.requestId,
              warning: event.warning,
            });
          else if (event.kind === 'foreground')
            listener({ kind: 'foreground' });
          else if (event.kind === 'continuation-foreground')
            listener({ kind: 'continuation-foreground' });
          else if (
            event.kind === 'expired' &&
            typeof event.requestId === 'string'
          )
            listener({ kind: 'expired', requestId: event.requestId });
          else if (
            event.kind === 'protectedData' &&
            typeof event.available === 'boolean'
          )
            listener({ kind: 'protectedData', available: event.available });
        },
      );
      const state = AppState.addEventListener('change', value => {
        if (value === 'active') listener({ kind: 'foreground' });
        else listener({ kind: 'phase' });
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
    bridgeAvailable: false,
    currentPhase,
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
        if (state !== 'active') listener({ kind: 'phase' });
        if (background)
          for (const requestId of active)
            listener({
              kind: 'expired',
              requestId,
              reason: 'bridge-unavailable',
            });
        else if (state === 'active') listener({ kind: 'foreground' });
      });
      return () => subscription.remove();
    },
  };
}

/** Only the bounded lifecycle state enters diagnostics, never native payloads. */
function currentPhase() {
  const state = AppState.currentState;
  return state === 'active' || state === 'background' || state === 'inactive'
    ? state
    : 'unknown';
}
