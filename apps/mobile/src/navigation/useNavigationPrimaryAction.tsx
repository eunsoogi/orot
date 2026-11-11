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
interface BackActionRegistration {
  readonly ownerKey: string;
  readonly token: symbol;
  readonly action: NavigationRouteBackAction;
}
export interface NavigationRouteAction extends NavigationPrimaryAction {
  readonly id: string;
  readonly systemImageName?: string;
  readonly busy?: boolean;
}
/** Overrides stack Back for a detail that opens and closes within one route. */
export interface NavigationRouteBackAction {
  readonly onPress: () => void | Promise<unknown>;
}
export interface NavigationPrimaryActionHost {
  readonly routeKey: string;
  readonly register: (registration: ActionRegistration) => () => void;
  /** Registers an in-route Back override and returns its cleanup function. */
  readonly registerBackAction: (
    registration: BackActionRegistration,
  ) => () => void;
}

export const NavigationPrimaryActionContext =
  createContext<NavigationPrimaryActionHost | null>(null);

/**
 * Only the visible route may publish page actions or an in-route Back override.
 * Retained overlay drafts keep their original owner.
 */
export function useNavigationPrimaryActionHost(routeKey: string) {
  const [registrations, setRegistrations] = useState<
    ReadonlyMap<symbol, ActionRegistration>
  >(new Map());
  const [backRegistrations, setBackRegistrations] = useState<
    ReadonlyMap<symbol, BackActionRegistration>
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
  const registerBackAction = useCallback((next: BackActionRegistration) => {
    setBackRegistrations(current => new Map(current).set(next.token, next));
    return () =>
      setBackRegistrations(current => {
        if (!current.has(next.token)) return current;
        const remaining = new Map(current);
        remaining.delete(next.token);
        return remaining;
      });
  }, []);
  const host = useMemo<NavigationPrimaryActionHost>(
    () => ({ routeKey, register, registerBackAction }),
    [routeKey, register, registerBackAction],
  );
  const actions = [...registrations.values()]
    .filter(registration => registration.ownerKey === routeKey)
    .flatMap(registration => registration.actions);
  const routeBackAction = [...backRegistrations.values()]
    .filter(registration => registration.ownerKey === routeKey)
    .at(-1)?.action;
  return { host, actions, action: actions.at(-1), routeBackAction };
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

/** Lets an in-route detail replace only the shared Back handler while it is mounted. */
export function useNavigationBackAction(
  onPress: () => void | Promise<unknown>,
): boolean {
  const host = useContext(NavigationPrimaryActionContext);
  const ownerKey = useRef(host?.routeKey);
  ownerKey.current ??= host?.routeKey;
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const registerBackAction = host?.registerBackAction;
  useLayoutEffect(() => {
    if (!registerBackAction || !ownerKey.current) return;
    let active = true;
    const unregister = registerBackAction({
      ownerKey: ownerKey.current,
      token: Symbol('route-back-action'),
      action: {
        onPress: () => (active ? onPressRef.current() : undefined),
      },
    });
    return () => {
      active = false;
      unregister();
    };
  }, [registerBackAction]);
  return host !== null;
}
