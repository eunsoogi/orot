import {
  workoutChoiceReceiptCurrent,
  watchWorkoutChoiceExpiry,
  type WorkoutChoiceReceipt,
} from './earlyWorkoutChoice';
import { useLayoutEffect, useRef } from 'react';

/** Parent revalidates the saved selection; native separately revalidates records.
 * Never start a replacement under an older selection generation after an OS pause. */
export function createOverviewWorkoutSelectionAdmission() {
  let selection: number | null | undefined;
  let blocked: number | undefined;
  let startup: WorkoutChoiceReceipt | undefined;
  let witness: string | null | undefined;
  let adopted: WorkoutChoiceReceipt | undefined;
  let pausedStartup: WorkoutChoiceReceipt | undefined;
  let restart: (() => void) | undefined;
  const mayStart = () =>
    selection === null
      ? !!startup &&
        startup !== pausedStartup &&
        workoutChoiceReceiptCurrent(startup)
      : selection === undefined || selection !== blocked;

  const exact = (receipt: WorkoutChoiceReceipt) =>
    typeof selection === 'number' &&
    witness !== undefined &&
    witness === receipt.witness;
  return {
    update(
      next: number | null | undefined,
      choice?: WorkoutChoiceReceipt,
      confirmedWitness?: string | null,
    ) {
      const changed =
        selection !== next ||
        startup !== choice ||
        witness !== confirmedWitness;
      startup = choice;
      witness = confirmedWitness;
      selection = next;
      if (adopted && !exact(adopted)) adopted = undefined;
      if (changed) restart?.();
    },
    pause() {
      pausedStartup = startup;
      if (typeof selection === 'number') blocked = selection;
    },
    mayStart,
    holds(receipt: WorkoutChoiceReceipt) {
      if (selection === null)
        return startup === receipt && workoutChoiceReceiptCurrent(receipt);
      return exact(receipt) && adopted === receipt;
    },
    adopt(receipt: WorkoutChoiceReceipt) {
      if (
        exact(receipt) &&
        (adopted === receipt || workoutChoiceReceiptCurrent(receipt))
      ) {
        adopted = receipt;
        return true;
      }
      return false;
    },
    startup: () => (selection === null ? startup : undefined),
    expireProvisional(
      receipt: WorkoutChoiceReceipt | undefined,
      current: () => boolean,
      retire: () => void,
    ) {
      return watchWorkoutChoiceExpiry(receipt, () => {
        if (adopted !== receipt && current()) retire();
      });
    },
    connect(next: () => void) {
      restart = next;
      return () => {
        if (restart === next) restart = undefined;
      };
    },
  };
}

export function useOverviewWorkoutSelectionAdmission(
  selectionEpoch: number | null | undefined,
  startup?: WorkoutChoiceReceipt,
  witness?: string | null,
) {
  const admission = useRef(createOverviewWorkoutSelectionAdmission()).current;
  useLayoutEffect(
    () => admission.update(selectionEpoch, startup, witness),
    [admission, selectionEpoch, startup, witness],
  );
  return admission;
}

export function syncWorkoutChoiceAdoption(
  owner:
    | {
        readonly receipt?: WorkoutChoiceReceipt;
        stopExpiry?: () => void;
        settled?: boolean;
        usable?: () => boolean;
      }
    | undefined,
  phase: () => string,
  admission: ReturnType<typeof createOverviewWorkoutSelectionAdmission>,
) {
  const receipt = owner?.receipt;
  if (!owner || !receipt) return true;
  const usable = owner.usable?.();
  if (usable === false || (owner.settled && usable !== true)) return false;
  if (phase() === 'active' && admission.adopt(receipt)) {
    owner.stopExpiry?.();
    owner.stopExpiry = undefined;
    return true;
  }
  return admission.holds(receipt);
}
