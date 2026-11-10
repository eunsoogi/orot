import { useCallback, useLayoutEffect, useRef } from 'react';
import { ActionSheetIOS, type NativeSyntheticEvent } from 'react-native';
import { navigationText } from '../i18n/navigation';
import type {
  NavigationGlassAction,
  NavigationGlassActionEvent,
  NavigationGlassActionEventHandler,
} from './NavigationGlassSurface';
import { settleNavigationRequest } from './nativeNavigationActions';
import { observeNavigationTest } from './navigationTestObservation';
import type { NavigationRouteAction } from './useNavigationPrimaryAction';

/** A route or action-state change invalidates an open menu and its callback. */
export function useBottomActionMenu({
  routeKey,
  navigation,
  pages,
  overflowNavigationIds,
  overflowPageIds,
  disabled,
  onNavigation,
}: {
  routeKey: string;
  navigation: readonly NavigationGlassAction[];
  pages: readonly NavigationRouteAction[];
  overflowNavigationIds: readonly string[];
  overflowPageIds: readonly string[];
  disabled: boolean;
  onNavigation: NavigationGlassActionEventHandler;
}) {
  const current = useRef({
    routeKey,
    navigation,
    pages,
    overflowNavigationIds,
    overflowPageIds,
    disabled,
    onNavigation,
  });
  current.current = {
    routeKey,
    navigation,
    pages,
    overflowNavigationIds,
    overflowPageIds,
    disabled,
    onNavigation,
  };
  const generation = useRef(0);
  const sequence = useRef(0);
  const open = useRef<number | null>(null);
  const signature = JSON.stringify([
    routeKey,
    disabled,
    navigation.map(
      ({
        id,
        label,
        accessibilityLabel,
        disabled: unavailable,
        busy,
        selected,
      }) => [id, label, accessibilityLabel, unavailable, busy, selected],
    ),
    pages.map(
      ({
        id,
        label,
        accessibilityLabel,
        disabled: unavailable,
        busy,
        destructive,
      }) => [id, label, accessibilityLabel, unavailable, busy, destructive],
    ),
  ]);
  useLayoutEffect(() => {
    generation.current += 1;
    if (open.current) {
      observeNavigationTest('menu-dismiss', { reason: 'signature-change' });
      open.current = null;
      ActionSheetIOS.dismissActionSheet();
    }
    return () => {
      generation.current += 1;
      if (open.current) {
        observeNavigationTest('menu-dismiss', { reason: 'effect-cleanup' });
        open.current = null;
        ActionSheetIOS.dismissActionSheet();
      }
    };
  }, [signature]);
  return useCallback(() => {
    const snapshot = current.current;
    observeNavigationTest('menu-handler', { routeKey: snapshot.routeKey });
    if (snapshot.disabled || open.current !== null) {
      observeNavigationTest('menu-rejected', {
        reason: snapshot.disabled ? 'disabled' : 'already-open',
      });
      return;
    }
    const entries = [
      ...snapshot.overflowNavigationIds
        .flatMap(id => snapshot.navigation.filter(action => action.id === id))
        .map(action => ({
          kind: 'navigation' as const,
          action,
        })),
      ...snapshot.overflowPageIds
        .flatMap(id => snapshot.pages.filter(action => action.id === id))
        .map(action => ({ kind: 'page' as const, action })),
    ];
    if (!entries.length) {
      observeNavigationTest('menu-rejected', { reason: 'empty' });
      return;
    }
    const labels = entries.map(({ kind, action }) => {
      const selected = kind === 'navigation' && action.selected;
      const busy = 'busy' in action && action.busy;
      return `${action.accessibilityLabel}${selected ? ' (선택됨)' : ''}${busy ? ' (진행 중)' : ''}`;
    });
    const token = generation.current;
    const menuID = ++sequence.current;
    open.current = menuID;
    observeNavigationTest('menu-show-request', { routeKey: snapshot.routeKey });
    ActionSheetIOS.showActionSheetWithOptions(
      {
        options: [...labels, navigationText.closeActionMenu],
        cancelButtonIndex: labels.length,
        disabledButtonIndices: entries.flatMap(({ action }, index) =>
          action.disabled ? [index] : [],
        ),
        destructiveButtonIndex: entries.flatMap(({ kind, action }, index) =>
          kind === 'page' && 'destructive' in action && action.destructive
            ? [index]
            : [],
        ),
      },
      index => {
        if (
          open.current !== menuID ||
          generation.current !== token ||
          current.current.routeKey !== snapshot.routeKey ||
          current.current.disabled
        )
          return;
        open.current = null;
        const entry = entries[index];
        if (!entry) return;
        if (entry.kind === 'navigation') {
          const action = current.current.navigation.find(
            item => item.id === entry.action.id,
          );
          if (action && !action.disabled)
            current.current.onNavigation({
              nativeEvent: { id: action.id },
            } as NativeSyntheticEvent<NavigationGlassActionEvent>);
        } else {
          const action = current.current.pages.find(
            item => item.id === entry.action.id,
          );
          if (action && !action.disabled)
            settleNavigationRequest(Promise.resolve(action.onPress()));
        }
      },
    );
  }, []);
}
