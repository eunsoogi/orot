import { render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../AppointmentReminderContext';
import { AppointmentReminderDeliveryHost } from '../AppointmentReminderDeliveryHost';
import { registerDailyReminderConsumer } from '../dailyReminderDelivery';
import {
  consumeDailyReminderTarget,
  acknowledgeDailyReminderTarget,
} from '../nativeReminderBridge';

jest.mock('../nativeReminderBridge', () => ({
  appointmentReminderPort: {
    readSelection: jest.fn(async () => null),
    authorizationStatus: jest.fn(async () => 'authorized'),
    replace: jest.fn(async () => undefined),
  },
  consumeAppointmentReminderTarget: jest.fn(async () => null),
  consumeDailyReminderTarget: jest.fn(),
  acknowledgeDailyReminderTarget: jest.fn(),
  subscribeAppointmentReminderOpened: jest.fn(() => () => {}),
}));

test('the app host hands a cold-start daily tap to the registered destination after the leave guard', async () => {
  const store = createAppointmentStore([]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('home');
  const guard = jest.fn(async () => true);
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    guard,
  );
  const pending = [{ kind: 'daily_report', deliveryTimestamp: '1700000000' }];
  jest
    .mocked(consumeDailyReminderTarget)
    .mockImplementation(async () => pending[0] ?? null);
  jest.mocked(acknowledgeDailyReminderTarget).mockImplementation(async () => {
    pending.shift();
  });
  const consumer = jest.fn(() => true);
  const unregister = registerDailyReminderConsumer(consumer);
  const view = await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() => expect(consumer).toHaveBeenCalledTimes(1));
  expect(guard).toHaveBeenCalledTimes(1);
  expect(consumer).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: 'daily_report',
      deliveryTimeZone: 'unknown',
    }),
  );
  expect(acknowledgeDailyReminderTarget).toHaveBeenCalledWith('1700000000');
  await view.unmount();
  unregister();
});

test('the app host surfaces an unavailable destination without navigating', async () => {
  const store = createAppointmentStore([]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('home');
  const pending = [{ kind: 'daily_report', deliveryTimestamp: '1700000000' }];
  jest
    .mocked(consumeDailyReminderTarget)
    .mockImplementation(async () => pending[0] ?? null);
  jest.mocked(acknowledgeDailyReminderTarget).mockImplementation(async () => {
    pending.shift();
  });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(controller.getSnapshot().currentRoute.name).toBe('home');
  await view.unmount();
  alert.mockRestore();
});
