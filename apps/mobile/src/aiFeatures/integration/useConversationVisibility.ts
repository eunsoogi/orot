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
  const routeOwnsDraft = useCallback(() => {
    const live = visibility.current;
    return (
      (live.isEntryCurrent?.() ?? true) &&
      !live.sourceDetailOpen &&
      !live.providerSelectionOpen
    );
  }, []);
  const current = useCallback(
    () =>
      (!visibility.current.requireForeground ||
        AppState.currentState === 'active') &&
      routeOwnsDraft(),
    [routeOwnsDraft],
  );
  const route = bookmarkOwnership?.route;
  const subscribeRoot = bookmarkOwnership?.subscribeRoot;
  return useMemo(
    () =>
      Object.assign(() => current(), { route, subscribeRoot, routeOwnsDraft }),
    [current, route, routeOwnsDraft, subscribeRoot],
  );
}
