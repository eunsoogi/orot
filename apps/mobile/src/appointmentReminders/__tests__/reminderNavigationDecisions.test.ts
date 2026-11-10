import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { createAppointmentReminderRuntime } from '../AppointmentReminderContext';
import { createReminderNavigationDecisions } from '../reminderNavigationDecisions';

test('retains the daily tap if the originating route changed or its guard is not ready', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  const decisions = createReminderNavigationDecisions(
    controller,
    runtime,
    jest.fn(),
  );
  const previous = controller.getSnapshot().currentRoute.key;
  controller.push('daily-report');
  expect(await decisions.daily(previous)).toBe('busy');
  expect(await decisions.daily(controller.getSnapshot().currentRoute.key)).toBe(
    'busy',
  );
});

test('appointment delivery defers an unavailable guard and rejects an outdated approval', async () => {
  const controller = createNavigationController<AppNavigationRoute>('home');
  const runtime = createAppointmentReminderRuntime(async () => {
    throw new Error('unused');
  });
  const decisions = createReminderNavigationDecisions(
    controller,
    runtime,
    jest.fn(),
  );
  const root = controller.getSnapshot().currentRoute;
  expect(await decisions.appointment()).toBe('busy');
  controller.registerLeaveGuard(root.key, async () => true);
  expect(await decisions.appointment()).toBe('approved');
  expect(decisions.appointmentRouteIsCurrent()).toBe(true);
  controller.push('daily-report');
  expect(decisions.appointmentRouteIsCurrent()).toBe(false);
});
