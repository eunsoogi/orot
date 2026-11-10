import type { NavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import type { AppointmentReminderRuntime } from '../../appointmentReminders/AppointmentReminderContext';
import { dailyReportConversationIntentStore } from './dailyReportConversationIntentStore';
import { hasPendingDailyConversationEntry } from './dailyReportConversationEntry';

/** Reopen only the retained date and route; recovery never starts inference. */
export async function restoreDailyReportConversation(input: {
  controller: NavigationController<AppNavigationRoute>;
  runtime: AppointmentReminderRuntime;
  confirm: (
    expectedRouteKey: string,
  ) => Promise<'approved' | 'declined' | 'busy' | 'unavailable'>;
  store?: typeof dailyReportConversationIntentStore;
}) {
  const store = input.store ?? dailyReportConversationIntentStore;
  const saved = await store.read();
  const version = store.version();
  if (!saved?.active) return 'done' as const;
  if (store.hasPendingDismissal(saved.intent.entryKey)) return 'busy' as const;
  if (
    [...input.runtime.dailyConversationTargets.values()].some(
      value => value.intent.entryKey === saved.intent.entryKey,
    )
  )
    return 'done' as const;
  if (
    input.runtime.dailyReportTargets.size ||
    hasPendingDailyConversationEntry(input.runtime)
  )
    return 'busy' as const;
  const before = input.controller.getSnapshot();
  const decision = await input.confirm(before.currentRoute.key);
  if (decision === 'declined') {
    await store.dismiss(saved.intent.entryKey);
    return 'done' as const;
  }
  if (decision === 'unavailable') return 'deferred' as const;
  if (decision === 'busy') return 'busy' as const;
  const current = input.controller.getSnapshot();
  if (
    current.isTransitioning ||
    current.currentRoute.key !== before.currentRoute.key ||
    input.runtime.dailyReportTargets.size ||
    hasPendingDailyConversationEntry(input.runtime) ||
    store.version() !== version
  )
    return 'busy' as const;
  const route = input.controller.push('daily-report');
  if (!route) return 'busy' as const;
  input.runtime.dailyConversationTargets.set(route.key, {
    intent: saved.intent,
  });
  return 'done' as const;
}
