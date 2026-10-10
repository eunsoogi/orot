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
  readonly action: NavigationPrimaryAction;
}
interface ActionHost {
  readonly routeKey: string;
  readonly register: (registration: ActionRegistration) => () => void;
}

export const NavigationPrimaryActionContext = createContext<ActionHost | null>(
  null,
);

/** Only the visible route may publish an action; retained overlay drafts keep their original owner. */
export function useNavigationPrimaryActionHost(routeKey: string) {
  const [registrations, setRegistrations] = useState<
    ReadonlyMap<string, ActionRegistration>
  >(new Map());
  const register = useCallback((next: ActionRegistration) => {
    setRegistrations(current => new Map(current).set(next.ownerKey, next));
    return () =>
      setRegistrations(current => {
        if (current.get(next.ownerKey)?.token !== next.token) return current;
        const remaining = new Map(current);
        remaining.delete(next.ownerKey);
        return remaining;
      });
  }, []);
  const host = useMemo(() => ({ routeKey, register }), [routeKey, register]);
  return {
    host,
    action: registrations.get(routeKey)?.action,
  };
}

/** Returns false outside the app shell so isolated screens retain their own usable action. */
export function useNavigationPrimaryAction(
  action: NavigationPrimaryAction | undefined,
): boolean {
  const host = useContext(NavigationPrimaryActionContext);
  const ownerKey = useRef(host?.routeKey);
  const onPressRef = useRef(action?.onPress);
  onPressRef.current = action?.onPress;
  const { label, accessibilityLabel, testID, disabled } = action ?? {};
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
    return register({
      ownerKey: ownerKey.current,
      token: Symbol('route-primary-action'),
      action: {
        label,
        accessibilityLabel,
        testID,
        disabled,
        onPress: () => onPressRef.current?.(),
      },
    });
  }, [register, label, accessibilityLabel, testID, disabled]);
  return host !== null;
}
