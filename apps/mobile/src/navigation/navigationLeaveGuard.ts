import type {
  NavigationLeaveGuard,
  NavigationTransition,
} from './navigationController';

export type NavigationLeaveReason =
  'unsaved-changes' | 'recording' | 'ongoing-operation';

export type NavigationLeaveOperationKind = 'account-connection';

export interface NavigationLeaveState {
  readonly hasUnsavedChanges: boolean;
  readonly isRecording: boolean;
  // Set only when the route's existing exit cleanup interrupts this operation.
  readonly hasOngoingOperation: boolean;
  // Optional kind selects precise copy without changing the shared guard reason.
  readonly ongoingOperationKind?: NavigationLeaveOperationKind;
  // Increment on any draft or activity change so an open prompt cannot approve stale state.
  readonly revision: number;
  // Increment for draft or transcript content changes, including finalized recording output.
  readonly inputRevision: number;
}

export interface NavigationLeaveConfirmation<
  Name extends string,
> extends NavigationTransition<Name> {
  readonly reasons: readonly NavigationLeaveReason[];
  readonly ongoingOperationKind?: NavigationLeaveOperationKind;
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
    if (initial.hasOngoingOperation) reasons.push('ongoing-operation');
    if (reasons.length === 0) return true;

    const approved = await options.confirm({
      ...transition,
      reasons,
      ongoingOperationKind: initial.ongoingOperationKind,
    });
    if (!approved) return false;

    const current = options.readState();
    if (
      current.revision !== initial.revision ||
      current.inputRevision !== initial.inputRevision ||
      current.hasUnsavedChanges !== initial.hasUnsavedChanges ||
      current.isRecording !== initial.isRecording ||
      current.hasOngoingOperation !== initial.hasOngoingOperation ||
      current.ongoingOperationKind !== initial.ongoingOperationKind
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
