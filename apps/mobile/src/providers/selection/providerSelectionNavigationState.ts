import { useCallback, useRef } from 'react';

export interface ProviderSelectionScreenNavigationState {
  readonly hasPendingSelection: boolean;
  readonly isSavingSelection: boolean;
  readonly inputRevision: number;
}

/** Keeps leave-state input revisions separate from the asynchronous save phase. */
export function useProviderSelectionNavigationState(
  onChange?: (state: ProviderSelectionScreenNavigationState) => void,
) {
  const stateRef = useRef<ProviderSelectionScreenNavigationState>({
    hasPendingSelection: false,
    isSavingSelection: false,
    inputRevision: 0,
  });

  return useCallback(
    (
      next: Omit<ProviderSelectionScreenNavigationState, 'inputRevision'>,
      inputChanged = false,
    ) => {
      const current = stateRef.current;
      const inputRevision = current.inputRevision + Number(inputChanged);
      if (
        current.hasPendingSelection === next.hasPendingSelection &&
        current.isSavingSelection === next.isSavingSelection &&
        current.inputRevision === inputRevision
      ) {
        return;
      }

      const updated = { ...next, inputRevision };
      stateRef.current = updated;
      onChange?.(updated);
    },
    [onChange],
  );
}
