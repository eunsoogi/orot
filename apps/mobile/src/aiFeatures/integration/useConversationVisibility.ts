import { useCallback, useRef } from 'react';

/** Recheck the live route and overlays when retained transcript layout arrives. */
export function useConversationVisibility(
  isEntryCurrent: (() => boolean) | undefined,
  sourceDetailOpen: boolean,
  providerSelectionOpen: boolean,
) {
  const visibility = useRef({
    isEntryCurrent,
    sourceDetailOpen,
    providerSelectionOpen,
  });
  visibility.current = {
    isEntryCurrent,
    sourceDetailOpen,
    providerSelectionOpen,
  };
  return useCallback(() => {
    const current = visibility.current;
    return (
      (current.isEntryCurrent?.() ?? true) &&
      !current.sourceDetailOpen &&
      !current.providerSelectionOpen
    );
  }, []);
}
