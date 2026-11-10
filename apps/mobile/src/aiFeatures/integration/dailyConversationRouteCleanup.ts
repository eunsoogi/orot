import type { AppointmentReminderRuntime } from '../../appointmentReminders/AppointmentReminderContext';
import { dailyReportConversationIntentStore } from './dailyReportConversationIntentStore';

/** Keep the route owner until its durable dismissal succeeds so later events can retry. */
export function createDailyConversationRouteCleanup(input: {
  runtime: AppointmentReminderRuntime;
  routeExists: (key: string) => boolean;
  store?: Pick<typeof dailyReportConversationIntentStore, 'dismiss'>;
}) {
  const pending = new Set<string>();
  const store = input.store ?? dailyReportConversationIntentStore;
  return () => {
    for (const [key, target] of input.runtime.dailyConversationTargets) {
      if (input.routeExists(key) || pending.has(key)) continue;
      pending.add(key);
      store
        .dismiss(target.intent.entryKey)
        .then(() => {
          if (
            !input.routeExists(key) &&
            input.runtime.dailyConversationTargets.get(key) === target
          )
            input.runtime.dailyConversationTargets.delete(key);
        })
        .catch(() => undefined)
        .finally(() => pending.delete(key));
    }
  };
}
