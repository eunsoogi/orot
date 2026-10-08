import type {
  NavigationLeaveGuard,
  NavigationTransition,
} from './navigationController';

export type NavigationLeaveReason = 'unsaved-changes' | 'recording';

export interface NavigationLeaveState {
  readonly hasUnsavedChanges: boolean;
  readonly isRecording: boolean;
  // Increment on any draft or activity change so an open prompt cannot approve stale state.
  readonly revision: number;
  // Increment for draft or transcript content changes, including finalized recording output.
  readonly inputRevision: number;
}

export interface NavigationLeaveConfirmation<
  Name extends string,
> extends NavigationTransition<Name> {
  readonly reasons: readonly NavigationLeaveReason[];
}

export interface NavigationLeaveGuardOptions<Name extends string> {
  readonly readState: () => NavigationLeaveState;
  readonly confirm: (
    request: NavigationLeaveConfirmation<Name>,
  ) => boolean | Promise<boolean>;
  // Resolve after readState exposes the stopped state and any finalized input.
  readonly stopRecording?: () => Promise<void>;
}

export function createNavigationLeaveGuard<Name extends string>(
  options: NavigationLeaveGuardOptions<Name>,
): NavigationLeaveGuard<Name> {
  return async transition => {
    const initial = options.readState();
    const reasons: NavigationLeaveReason[] = [];
    if (initial.hasUnsavedChanges) reasons.push('unsaved-changes');
    if (initial.isRecording) reasons.push('recording');
    if (reasons.length === 0) return true;

    const approved = await options.confirm({ ...transition, reasons });
    if (!approved) return false;

    const current = options.readState();
    if (
      current.revision !== initial.revision ||
      current.inputRevision !== initial.inputRevision ||
      current.hasUnsavedChanges !== initial.hasUnsavedChanges ||
      current.isRecording !== initial.isRecording
    ) {
      return false;
    }

    if (initial.isRecording) {
      if (!options.stopRecording) return false;
      try {
        await options.stopRecording();
      } catch {
        return false;
      }

      const afterStop = options.readState();
      if (
        afterStop.isRecording ||
        afterStop.inputRevision !== current.inputRevision ||
        afterStop.hasUnsavedChanges !== current.hasUnsavedChanges
      ) {
        return false;
      }
    }
    return true;
  };
}
