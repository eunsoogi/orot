import { useEffect, useMemo, useRef } from 'react';
import { AppointmentReminderDeliveryHost } from '../appointmentReminders/AppointmentReminderDeliveryHost';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import { useAssistantAppearance } from './AssistantAppearanceProvider';

export function GatedReminderDeliveryHost({
  controller,
}: {
  controller: NavigationController<AppNavigationRoute>;
}) {
  const appearance = useAssistantAppearance();
  return (
    <ReminderGate
      controller={controller}
      ready={appearance?.ready === true}
      canEnter={appearance?.canEnter}
    />
  );
}

/** Keep the existing inbox alive while preventing late async navigation through a closed gate. */
export function ReminderGate({
  controller,
  ready,
  canEnter,
}: {
  controller: NavigationController<AppNavigationRoute>;
  ready: boolean;
  canEnter?: () => boolean;
}) {
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const canEnterRef = useRef(canEnter);
  canEnterRef.current = canEnter;
  const listeners = useMemo(() => new Set<() => void>(), []);
  const guarded = useMemo<NavigationController<AppNavigationRoute>>(
    () => ({
      ...controller,
      subscribe: listener => {
        listeners.add(listener);
        const unsubscribe = controller.subscribe(listener);
        return () => {
          listeners.delete(listener);
          unsubscribe();
        };
      },
      push: name =>
        readyRef.current && (canEnterRef.current?.() ?? true)
          ? controller.push(name)
          : null,
      replace: name =>
        readyRef.current && (canEnterRef.current?.() ?? true)
          ? controller.replace(name)
          : null,
      requestTabSwitchDecision: async () => {
        if (!readyRef.current || !(canEnterRef.current?.() ?? true))
          return 'busy';
        const result = await controller.requestTabSwitchDecision();
        return readyRef.current && (canEnterRef.current?.() ?? true)
          ? result
          : 'busy';
      },
    }),
    [controller, listeners],
  );
  useEffect(() => {
    if (ready) listeners.forEach(listener => listener());
  }, [ready, listeners]);
  return <AppointmentReminderDeliveryHost controller={guarded} />;
}
