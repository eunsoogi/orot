import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import type { NavigationLeaveState } from './navigationLeaveGuard';

type NavigationLeaveStateRegistrationSource = {
  readonly readState: () => NavigationLeaveState;
  readonly stopRecording?: () => Promise<void>;
};

export type NavigationLeaveStateRegistration = (
  source: NavigationLeaveStateRegistrationSource,
) => () => void;

const NavigationLeaveStateRegistrationContext =
  createContext<NavigationLeaveStateRegistration | null>(null);

export function NavigationLeaveStateRegistrationProvider({
  children,
  registerLeaveState,
}: {
  readonly children: ReactNode;
  readonly registerLeaveState: NavigationLeaveStateRegistration;
}) {
  return (
    <NavigationLeaveStateRegistrationContext.Provider
      value={registerLeaveState}
    >
      {children}
    </NavigationLeaveStateRegistrationContext.Provider>
  );
}

/** Registers screen-owned state and refreshes the adapter when it changes. */
export function useNavigationLeaveStateRegistration(
  state: NavigationLeaveState,
  stopRecording?: () => Promise<void>,
): boolean {
  const registerLeaveState = useContext(
    NavigationLeaveStateRegistrationContext,
  );
  const stateRef = useRef(state);
  const stopRecordingRef = useRef(stopRecording);
  const stopCommitWaiters = useRef(new Set<() => void>());
  const [stopCommitRevision, scheduleStopCommit] = useState(0);
  stateRef.current = state;
  stopRecordingRef.current = stopRecording;

  const source = useMemo<NavigationLeaveStateRegistrationSource>(
    () => ({
      readState: () => stateRef.current,
      stopRecording: async () => {
        const stop = stopRecordingRef.current;
        if (!stop) throw new Error('This screen has no recording to stop.');
        await stop();
        // React may not have committed the stop/save state when the callback resolves.
        await new Promise<void>(resolve => {
          stopCommitWaiters.current.add(resolve);
          scheduleStopCommit(revision => revision + 1);
        });
      },
    }),
    [scheduleStopCommit],
  );
  const stateKey = [
    state.canLeave,
    state.hasUnsavedChanges,
    state.isRecording,
    state.hasOngoingOperation,
    state.ongoingOperationKind,
    state.backgroundOperationKind,
    state.revision,
    state.inputRevision,
  ].join(':');

  useLayoutEffect(() => {
    const unregister = registerLeaveState?.(source);
    const waiters = [...stopCommitWaiters.current];
    stopCommitWaiters.current.clear();
    waiters.forEach(resolve => resolve());
    return unregister;
  }, [registerLeaveState, source, stateKey, stopCommitRevision]);

  return registerLeaveState !== null;
}
