import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { NavigationPrimaryAction } from './NavigationActionBar';

interface ActionRegistration {
  readonly ownerKey: string;
  readonly token: symbol;
  readonly actions: readonly NavigationRouteAction[];
}
export interface NavigationRouteAction extends NavigationPrimaryAction {
  readonly id: string;
  readonly systemImageName?: string;
  readonly busy?: boolean;
}
export interface NavigationPrimaryActionHost {
  readonly routeKey: string;
  readonly register: (registration: ActionRegistration) => () => void;
}

export const NavigationPrimaryActionContext =
  createContext<NavigationPrimaryActionHost | null>(null);

/** Only the visible route may publish an action; retained overlay drafts keep their original owner. */
export function useNavigationPrimaryActionHost(routeKey: string) {
  const [registrations, setRegistrations] = useState<
    ReadonlyMap<symbol, ActionRegistration>
  >(new Map());
  const register = useCallback((next: ActionRegistration) => {
    setRegistrations(current => new Map(current).set(next.token, next));
    return () =>
      setRegistrations(current => {
        if (!current.has(next.token)) return current;
        const remaining = new Map(current);
        remaining.delete(next.token);
        return remaining;
      });
  }, []);
  const host = useMemo<NavigationPrimaryActionHost>(
    () => ({ routeKey, register }),
    [routeKey, register],
  );
  const actions = [...registrations.values()]
    .filter(registration => registration.ownerKey === routeKey)
    .flatMap(registration => registration.actions);
  return { host, actions, action: actions.at(-1) };
}

/** Returns false outside the app shell so isolated screens retain their own usable action. */
export function useNavigationPrimaryAction(
  action: NavigationPrimaryAction | undefined,
): boolean {
  const host = useContext(NavigationPrimaryActionContext);
  const ownerKey = useRef(host?.routeKey);
  // A retained scene can mount before it first receives the focused host.
  ownerKey.current ??= host?.routeKey;
  const onPressRef = useRef(action?.onPress);
  onPressRef.current = action?.onPress;
  const {
    label,
    navigationLabel,
    navigationPriority,
    destructive,
    accessibilityLabel,
    testID,
    disabled,
    systemImageName,
  } = action ?? {};
  const register = host?.register;
  useLayoutEffect(() => {
    if (
      !register ||
      !ownerKey.current ||
      !label ||
      !accessibilityLabel ||
      !testID
    )
      return;
    let active = true;
    const unregister = register({
      ownerKey: ownerKey.current,
      token: Symbol('route-primary-action'),
      actions: [
        {
          id: 'primary',
          label,
          navigationLabel,
          navigationPriority,
          destructive,
          accessibilityLabel,
          testID,
          disabled,
          systemImageName,
          onPress: () => (active ? onPressRef.current?.() : undefined),
        },
      ],
    });
    return () => {
      active = false;
      unregister();
    };
  }, [
    register,
    label,
    navigationLabel,
    navigationPriority,
    destructive,
    accessibilityLabel,
    testID,
    disabled,
    systemImageName,
  ]);
  return host !== null;
}
