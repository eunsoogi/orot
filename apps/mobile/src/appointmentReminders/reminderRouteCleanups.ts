import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { AppointmentReminderRuntime } from './AppointmentReminderContext';
import { createDailyReminderRouteCleanup } from './dailyReminderRouteCleanup';
import { createDailyConversationRouteCleanup } from '../aiFeatures/integration/dailyConversationRouteCleanup';

/** Keep both retained reminder destinations aligned with the same route snapshot. */
export function createReminderRouteCleanups(input: {
  runtime: AppointmentReminderRuntime;
  controller: NavigationController<AppNavigationRoute>;
  dismiss: Parameters<typeof createDailyReminderRouteCleanup>[0]['dismiss'];
}) {
  const routeExists = (key: string) =>
    input.controller.getSnapshot().routes.some(route => route.key === key);
  return {
    conversation: createDailyConversationRouteCleanup({
      runtime: input.runtime,
      routeExists,
    }),
    daily: createDailyReminderRouteCleanup({
      runtime: input.runtime,
      routeExists,
      dismiss: input.dismiss,
    }),
  };
}
