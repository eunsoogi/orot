import { createDailyReminderDelivery } from './dailyReminderDelivery';

/** Report a deferred explicit tap so its passive restore cannot re-prompt it immediately. */
export function createTrackedDailyReminderDelivery(
  port: Parameters<typeof createDailyReminderDelivery>[0],
) {
  let busy = false;
  const deliver = createDailyReminderDelivery({
    ...port,
    onBusy: () => {
      busy = true;
      port.onBusy();
    },
  });
  return async () => {
    busy = false;
    await deliver();
    return !busy;
  };
}
