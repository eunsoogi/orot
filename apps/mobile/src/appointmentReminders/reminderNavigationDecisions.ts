import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { AppointmentReminderRuntime } from './AppointmentReminderContext';

/** Only navigation decisions share a queue; inbox storage remains independent. */
export function createReminderNavigationDecisions(
  controller: NavigationController<AppNavigationRoute>,
  runtime: AppointmentReminderRuntime,
  onBusy: () => void,
) {
  let queue = Promise.resolve();
  let approvedAppointmentRoute: string | null = null;
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };
  return {
    appointment: () => {
      approvedAppointmentRoute = null;
      const expectedRouteKey = controller.getSnapshot().currentRoute.key;
      return serial(async () => {
        if (controller.getSnapshot().isTransitioning) {
          onBusy();
          return 'busy' as const;
        }
        if (controller.getSnapshot().currentRoute.key !== expectedRouteKey) {
          onBusy();
          return 'busy' as const;
        }
        const result = await controller.requestTabSwitchDecision();
        if (result === 'unavailable' || result === 'busy') {
          onBusy();
          return 'busy' as const;
        }
        if (result === 'approved') approvedAppointmentRoute = expectedRouteKey;
        return result;
      });
    },
    appointmentRouteIsCurrent: () => {
      const snapshot = controller.getSnapshot();
      return (
        !snapshot.isTransitioning &&
        snapshot.currentRoute.key === approvedAppointmentRoute
      );
    },
    conversation: (expectedRouteKey: string) =>
      serial(async () => {
        if (
          runtime.dailyReportTargets.size ||
          controller.getSnapshot().currentRoute.key !== expectedRouteKey
        )
          return 'busy' as const;
        return controller.requestTabSwitchDecision();
      }),
    daily: (expectedRouteKey: string) =>
      serial(async () => {
        if (controller.getSnapshot().currentRoute.key !== expectedRouteKey)
          return 'busy' as const;
        const result = await controller.requestTabSwitchDecision();
        return result === 'unavailable' ? ('busy' as const) : result;
      }),
  };
}
