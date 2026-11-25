import { useCallback, useMemo, useRef } from 'react';
import { AppState } from 'react-native';
import type { ReportBookmarkVisibility } from '../../ragConversation/reportBookmarkOwnership';

/** Keep route/overlay ownership distinct from foreground-only action authority. */
export function useConversationVisibility(
  isEntryCurrent: (() => boolean) | undefined,
  sourceDetailOpen: boolean,
  providerSelectionOpen: boolean,
  requireForeground = false,
  bookmarkOwnership?: Pick<ReportBookmarkVisibility, 'route' | 'subscribeRoot'>,
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
  const current = useCallback(() => {
    const current = visibility.current;
    return (
      (!current.requireForeground || AppState.currentState === 'active') &&
      (current.isEntryCurrent?.() ?? true) &&
      !current.sourceDetailOpen &&
      !current.providerSelectionOpen
    );
  }, []);
  const route = bookmarkOwnership?.route;
  const subscribeRoot = bookmarkOwnership?.subscribeRoot;
  return useMemo(
    () => Object.assign(() => current(), { route, subscribeRoot }),
    [current, route, subscribeRoot],
  );
}
