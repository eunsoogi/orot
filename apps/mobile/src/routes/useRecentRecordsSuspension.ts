import { useLayoutEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { useNavigationRouteScrollPosition } from '../navigation/NavigationRouteScrollView';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import type { RecordsTabAuthority } from './useAppRootTab';
import { isProtectedDataReadable } from './requestRecentSavedMaterialPage';

type HeldOffset = {
  readonly owner: () => boolean;
  readonly ticket: number;
  readonly restore: (current: () => boolean) => void;
};

/** The only retained state of an inactive list is its scroll offset. Rows still
 * retire through existing Records guards, including on native lock. */
export function useRecentRecordsSuspension(
  active: boolean,
  ownership?: NavigationRouteOwnership,
  tab?: RecordsTabAuthority,
) {
  const [phase, setPhase] = useState<string | null | undefined>(
    AppState.currentState,
  );
  const position = useNavigationRouteScrollPosition();
  const held = useRef<HeldOffset | undefined>(undefined);
  const ticket = useRef(0);
  const previous = useRef(false);
  const published = useRef(false);
  const currentFeed = useRef(false);
  useLayoutEffect(() => {
    held.current = undefined;
    previous.current = AppState.currentState === 'active';
    if (!active) return;
    const isTab = tab?.capture();
    let mounted = true;
    const owner = () =>
      mounted && (ownership?.isCurrent() ?? true) && (isTab?.() ?? true);
    const drop = () => {
      held.current = undefined;
      ticket.current++;
    };
    const onChange = (next: AppStateStatus) => {
      if (next === 'inactive' && previous.current) {
        drop();
        if (owner() && published.current && position)
          held.current = {
            owner,
            ticket: ticket.current,
            restore: position.capture(),
          };
      } else if (next !== 'inactive' && next !== 'active') drop();
      previous.current = next === 'active';
      setPhase(next);
    };
    setPhase(AppState.currentState);
    const app = AppState.addEventListener('change', onChange);
    const leave = ownership?.subscribe(() => {
      if (!owner()) drop();
    });
    const switchTab = tab?.subscribe(drop);
    const protection = conversationExecutionNative();
    const protectionChanged = protection?.bridgeAvailable
      ? protection.subscribe(event => {
          if (event.kind === 'protectedData' && !event.available) drop();
        })
      : undefined;
    return () => {
      mounted = false;
      drop();
      app.remove();
      leave?.();
      switchTab?.();
      protectionChanged?.();
    };
  }, [active, ownership, position, tab]);
  return {
    hidden:
      phase === 'inactive' ||
      phase === 'background' ||
      AppState.currentState === 'inactive' ||
      AppState.currentState === 'background',
    update(fresh: boolean, failed: boolean, hasRows: boolean) {
      // Fresh source meaning belongs to the active feed; only offset currentness
      // is rechecked here. No previously loaded row can be published.
      currentFeed.current = fresh && !failed && hasRows;
      if (failed) {
        held.current = undefined;
        ticket.current++;
      }
      if (phase !== 'active') return;
      published.current = currentFeed.current;
      if (!currentFeed.current) return;
      const value = held.current;
      if (!value) return;
      const protection = conversationExecutionNative();
      const current = () =>
        ticket.current === value.ticket &&
        value.owner() &&
        AppState.currentState === 'active' &&
        currentFeed.current;
      if (!current() || !protection?.bridgeAvailable) return;
      held.current = undefined;
      isProtectedDataReadable(protection)
        .then(allowed => {
          if (allowed && current()) value.restore(current);
        })
        .catch(() => undefined);
    },
  };
}
