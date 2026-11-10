import { createAppointmentReminderRuntime } from '../../../appointmentReminders/AppointmentReminderContext';
import { createDailyConversationRouteCleanup } from '../dailyConversationRouteCleanup';

test('retains the route identity after a failed durable dismissal and retries on the next event', async () => {
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  const intent = {
    kind: 'daily-report' as const,
    entryKey: 'daily-conversation:test-1',
    request: {
      localDate: '2026-11-09',
      timeZone: 'Asia/Seoul',
      requestedAt: '2026-11-09T03:00:00Z',
    },
  };
  runtime.dailyConversationTargets.set('route', { intent });
  const dismiss = jest
    .fn()
    .mockRejectedValueOnce(new Error('locked'))
    .mockResolvedValue(undefined);
  const clean = createDailyConversationRouteCleanup({
    runtime,
    routeExists: () => false,
    store: { dismiss },
  });
  clean();
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(runtime.dailyConversationTargets.has('route')).toBe(true);
  clean();
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(dismiss).toHaveBeenCalledTimes(2);
  expect(runtime.dailyConversationTargets.has('route')).toBe(false);
});
