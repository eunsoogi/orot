import { useContext, useLayoutEffect, useRef } from 'react';
import {
  NavigationPrimaryActionContext,
  type NavigationRouteAction,
} from './useNavigationPrimaryAction';

/** Registers a focused screen's actions without retaining callbacks after cleanup. */
export function useNavigationRouteActions(
  actions: readonly NavigationRouteAction[],
): boolean {
  const host = useContext(NavigationPrimaryActionContext);
  const ownerKey = useRef(host?.routeKey);
  ownerKey.current ??= host?.routeKey;
  const currentActions = useRef(actions);
  const pending = useRef(new Map<string, symbol>());
  const previousActions = useRef(new Map<string, NavigationRouteAction>());
  currentActions.current = actions;
  // Callback identity is deliberately excluded: dispatch reads the latest callback.
  const signature = JSON.stringify(
    actions.map(
      ({
        id,
        label,
        accessibilityLabel,
        testID,
        disabled,
        systemImageName,
        busy,
      }) => ({
        id,
        label,
        accessibilityLabel,
        testID,
        disabled,
        systemImageName,
        busy,
      }),
    ),
  );
  const register = host?.register;
  useLayoutEffect(() => {
    const next = new Map(
      currentActions.current.map(action => [action.id, action]),
    );
    for (const [id, previous] of previousActions.current) {
      const current = next.get(id);
      // Cancellation may release an operation before its old Promise settles.
      if (
        !current ||
        ((previous.disabled || previous.busy) &&
          !current.disabled &&
          !current.busy)
      )
        pending.current.delete(id);
    }
    previousActions.current = next;
  }, [signature]);
  useLayoutEffect(() => {
    if (!register || !ownerKey.current || currentActions.current.length === 0)
      return;
    let active = true;
    const registered = currentActions.current.map(action => ({
      ...action,
      onPress: () => {
        const current = currentActions.current.find(
          item => item.id === action.id,
        );
        if (
          !active ||
          !current ||
          current.disabled ||
          pending.current.has(action.id)
        )
          return;
        // Lock before dispatch so a void callback cannot run twice in one event turn.
        const invocation = Symbol(action.id);
        pending.current.set(action.id, invocation);
        const release = () => {
          if (pending.current.get(action.id) === invocation)
            pending.current.delete(action.id);
        };
        try {
          const result = current.onPress();
          if (result && typeof result.then === 'function') {
            return Promise.resolve(result).finally(release);
          }
          queueMicrotask(release);
        } catch (error) {
          release();
          throw error;
        }
      },
    }));
    const unregister = register({
      ownerKey: ownerKey.current,
      token: Symbol('route-actions'),
      actions: registered,
    });
    return () => {
      active = false;
      unregister();
    };
  }, [register, signature]);
  return host !== null;
}
