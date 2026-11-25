import { useLayoutEffect, useRef } from 'react';

/** Parent revalidates the saved selection; native separately revalidates records.
 * Never start a replacement under an older selection generation after an OS pause. */
export function createOverviewWorkoutSelectionAdmission() {
  let selection: number | null | undefined;
  let blocked: number | undefined;
  let restart: (() => void) | undefined;
  return {
    update(next: number | null | undefined) {
      const changed = selection !== next;
      selection = next;
      if (changed && next !== null && next !== blocked) restart?.();
    },
    pause() {
      if (typeof selection === 'number') blocked = selection;
    },
    mayStart() {
      return (
        selection !== null && (selection === undefined || selection !== blocked)
      );
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
) {
  const admission = useRef(createOverviewWorkoutSelectionAdmission()).current;
  useLayoutEffect(
    () => admission.update(selectionEpoch),
    [admission, selectionEpoch],
  );
  return admission;
}
