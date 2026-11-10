import { act, render, waitFor } from '@testing-library/react-native';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../AppointmentReminderContext';
import { AppointmentReminderDeliveryHost } from '../AppointmentReminderDeliveryHost';
import { dailyReminderIntentStore } from '../dailyReminderIntentStore';
import { parseDailyReminderEntry } from '../dailyReminderDelivery';
import {
  consumeDailyReminderTarget,
  consumeAppointmentReminderTarget,
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
jest.mock('../dailyReminderIntentStore', () => ({
  dailyReminderIntentStore: {
    read: jest.fn(async () => null),
    write: jest.fn(async () => undefined),
  },
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
  const view = await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() =>
    expect(acknowledgeDailyReminderTarget).toHaveBeenCalledWith('1700000000'),
  );
  expect(guard).toHaveBeenCalledTimes(1);
  expect(dailyReminderIntentStore.write).toHaveBeenCalledWith(
    expect.objectContaining({
      active: true,
      entry: expect.objectContaining({
        kind: 'daily_report',
        deliveryTimeZone: 'unknown',
      }),
    }),
  );
  expect(controller.getSnapshot().currentRoute.name).toBe('daily-report');
  expect(acknowledgeDailyReminderTarget).toHaveBeenCalledWith('1700000000');
  await view.unmount();
});

test('the app host retains the tap when durable intent cannot be saved', async () => {
  jest.clearAllMocks();
  const store = createAppointmentStore([]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('home');
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    async () => true,
  );
  jest
    .mocked(dailyReminderIntentStore.write)
    .mockRejectedValueOnce(new Error('storage unavailable'));
  jest.mocked(acknowledgeDailyReminderTarget).mockClear();
  const pending = [{ kind: 'daily_report', deliveryTimestamp: '1700000000' }];
  jest
    .mocked(consumeDailyReminderTarget)
    .mockImplementation(async () => pending[0] ?? null);
  jest.mocked(acknowledgeDailyReminderTarget).mockImplementation(async () => {
    pending.shift();
  });
  const view = await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() =>
    expect(dailyReminderIntentStore.write).toHaveBeenCalled(),
  );
  expect(controller.getSnapshot().currentRoute.name).toBe('home');
  expect(acknowledgeDailyReminderTarget).not.toHaveBeenCalled();
  await view.unmount();
});

test('retries an acknowledged durable intent after a busy navigation transition', async () => {
  jest.clearAllMocks();
  const entry = parseDailyReminderEntry(
    { kind: 'daily_report', deliveryTimestamp: '1700000000' },
    'Asia/Seoul',
  )!;
  jest
    .mocked(dailyReminderIntentStore.read)
    .mockResolvedValue({ entry, active: true });
  jest.mocked(consumeDailyReminderTarget).mockResolvedValue(null);
  const store = createAppointmentStore([]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('home');
  let release!: (allowed: boolean) => void;
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = resolve;
          }),
      )
      .mockResolvedValue(true),
  );
  const transition = controller.requestTabSwitch();
  const view = await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() => expect(dailyReminderIntentStore.read).toHaveBeenCalled());
  expect(controller.getSnapshot().currentRoute.name).toBe('home');
  await act(async () => {
    release(true);
    await transition;
  });
  await waitFor(() =>
    expect(controller.getSnapshot().currentRoute.name).toBe('daily-report'),
  );
  expect(
    runtime.dailyReportTargets.get(controller.getSnapshot().currentRoute.key),
  ).toEqual(entry);
  await view.unmount();
});

test('a stalled daily intent store does not prevent the appointment inbox from draining', async () => {
  jest.clearAllMocks();
  jest
    .mocked(dailyReminderIntentStore.read)
    .mockImplementation(() => new Promise(() => {}));
  const store = createAppointmentStore([]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('home');
  const view = await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() =>
    expect(consumeAppointmentReminderTarget).toHaveBeenCalled(),
  );
  await view.unmount();
});

test('checks the current route only after the daily intent is durable', async () => {
  jest.clearAllMocks();
  jest.mocked(dailyReminderIntentStore.read).mockResolvedValue(null);
  let release!: () => void;
  jest
    .mocked(dailyReminderIntentStore.write)
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          release = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const pending = [{ kind: 'daily_report', deliveryTimestamp: '1700000000' }];
  jest
    .mocked(consumeDailyReminderTarget)
    .mockImplementation(async () => pending[0] ?? null);
  jest.mocked(acknowledgeDailyReminderTarget).mockImplementation(async () => {
    pending.shift();
  });
  const store = createAppointmentStore([]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('home');
  const homeGuard = jest.fn(async () => true);
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    homeGuard,
  );
  const view = await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() =>
    expect(dailyReminderIntentStore.write).toHaveBeenCalled(),
  );
  const editing = controller.push('health-records')!;
  const editGuard = jest.fn(
    async (_transition, onExplicitDecline?: () => void) => {
      onExplicitDecline?.();
      return false;
    },
  );
  controller.registerLeaveGuard(editing.key, editGuard);
  await act(async () => {
    release();
  });
  await waitFor(() =>
    expect(acknowledgeDailyReminderTarget).toHaveBeenCalled(),
  );
  expect(editGuard).toHaveBeenCalled();
  expect(homeGuard).not.toHaveBeenCalled();
  expect(controller.getSnapshot().currentRoute.name).toBe('health-records');
  await view.unmount();
});
