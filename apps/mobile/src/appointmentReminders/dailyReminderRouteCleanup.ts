import type { AppointmentReminderRuntime } from './AppointmentReminderContext';

/** Retained detours keep targets until their owning route leaves the stack. */
export function pruneClosedReminderRoutes(
  runtime: AppointmentReminderRuntime,
  routeExists: (key: string) => boolean,
) {
  for (const targets of [
    runtime.targets,
    runtime.overviewPreparationTargets,
    runtime.dailyReportFollowUps,
  ]) {
    for (const key of targets.keys()) {
      if (!routeExists(key)) targets.delete(key);
    }
  }
}

/** Keep closed route ownership until durable dismissal succeeds; callers retry on lifecycle events. */
export function createDailyReminderRouteCleanup(input: {
  runtime: AppointmentReminderRuntime;
  routeExists: (key: string) => boolean;
  dismiss: (entryKey: string) => Promise<void>;
}) {
  return async () => {
    let removed = false;
    for (const [key, entry] of input.runtime.dailyReportTargets) {
      if (input.routeExists(key)) continue;
      await input.dismiss(entry.entryKey);
      if (
        !input.routeExists(key) &&
        input.runtime.dailyReportTargets.get(key)?.entryKey === entry.entryKey
      ) {
        input.runtime.dailyReportTargets.delete(key);
        removed = true;
      }
    }
    return removed;
  };
}
