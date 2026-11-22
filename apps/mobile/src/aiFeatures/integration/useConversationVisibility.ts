import { useCallback, useRef } from 'react';
import { AppState } from 'react-native';

/** Keep route/overlay ownership distinct from foreground-only action authority. */
export function useConversationVisibility(
  isEntryCurrent: (() => boolean) | undefined,
  sourceDetailOpen: boolean,
  providerSelectionOpen: boolean,
  requireForeground = false,
) {
  const visibility = useRef({
    isEntryCurrent,
    sourceDetailOpen,
    providerSelectionOpen,
    requireForeground,
  });
  visibility.current = {
    isEntryCurrent,
    sourceDetailOpen,
    providerSelectionOpen,
    requireForeground,
  };
  return useCallback(() => {
    const current = visibility.current;
    return (
      (!current.requireForeground || AppState.currentState === 'active') &&
      (current.isEntryCurrent?.() ?? true) &&
      !current.sourceDetailOpen &&
      !current.providerSelectionOpen
    );
  }, []);
}
