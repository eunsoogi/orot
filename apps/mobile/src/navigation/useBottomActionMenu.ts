import { useCallback, useLayoutEffect, useRef } from 'react';
import { ActionSheetIOS, type NativeSyntheticEvent } from 'react-native';
import { navigationText } from '../i18n/navigation';
import type {
  NavigationGlassAction,
  NavigationGlassActionEvent,
  NavigationGlassActionEventHandler,
} from './NavigationGlassSurface';
import { settleNavigationRequest } from './nativeNavigationActions';
import type { NavigationRouteAction } from './useNavigationPrimaryAction';

/** A route or action-state change invalidates an open menu and its callback. */
export function useBottomActionMenu({
  routeKey,
  navigation,
  pages,
  disabled,
  onNavigation,
}: {
  routeKey: string;
  navigation: readonly NavigationGlassAction[];
  pages: readonly NavigationRouteAction[];
  disabled: boolean;
  onNavigation: NavigationGlassActionEventHandler;
}) {
  const current = useRef({
    routeKey,
    navigation,
    pages,
    disabled,
    onNavigation,
  });
  current.current = { routeKey, navigation, pages, disabled, onNavigation };
  const generation = useRef(0);
  const open = useRef(false);
  const signature = JSON.stringify([
    routeKey,
    disabled,
    navigation,
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
      open.current = false;
      ActionSheetIOS.dismissActionSheet();
    }
    return () => {
      generation.current += 1;
      if (open.current) {
        open.current = false;
        ActionSheetIOS.dismissActionSheet();
      }
    };
  }, [signature]);
  return useCallback(() => {
    const snapshot = current.current;
    if (snapshot.disabled || open.current) return;
    const entries = [
      ...snapshot.navigation.map(action => ({
        kind: 'navigation' as const,
        action,
      })),
      ...snapshot.pages.map(action => ({ kind: 'page' as const, action })),
    ];
    if (!entries.length) return;
    const labels = entries.map(({ kind, action }) => {
      const selected = kind === 'navigation' && action.selected;
      const busy = 'busy' in action && action.busy;
      return `${action.accessibilityLabel}${selected ? ' (선택됨)' : ''}${busy ? ' (진행 중)' : ''}`;
    });
    const token = generation.current;
    open.current = true;
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
        open.current = false;
        if (
          generation.current !== token ||
          current.current.routeKey !== snapshot.routeKey ||
          current.current.disabled
        )
          return;
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
