import { act, render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../AppointmentReminderContext';
import { AppointmentReminderDeliveryHost } from '../AppointmentReminderDeliveryHost';
import { parseDailyReminderEntry } from '../dailyReminderDelivery';
import { dailyReminderIntentStore } from '../dailyReminderIntentStore';

jest.mock('../nativeReminderBridge', () => ({
  appointmentReminderPort: {
    readSelection: jest.fn(async () => null),
    authorizationStatus: jest.fn(async () => 'authorized'),
    replace: jest.fn(async () => undefined),
  },
  consumeAppointmentReminderTarget: jest.fn(async () => null),
  consumeDailyReminderTarget: jest.fn(async () => null),
  acknowledgeDailyReminderTarget: jest.fn(async () => undefined),
  subscribeAppointmentReminderOpened: jest.fn(() => () => {}),
}));
jest.mock('../dailyReminderIntentStore', () => ({
  dailyReminderIntentStore: { read: jest.fn(), write: jest.fn() },
}));

test.each(['foreground', 'host restart'] as const)(
  'retries a failed dismissal after %s without reopening it',
  async trigger => {
    jest.clearAllMocks();
    const entry = parseDailyReminderEntry(
      { kind: 'daily_report', deliveryTimestamp: '1700000000' },
      'Asia/Seoul',
    )!;
    let saved = { entry, active: true };
    jest
      .mocked(dailyReminderIntentStore.read)
      .mockImplementation(async () => saved);
    jest
      .mocked(dailyReminderIntentStore.write)
      .mockRejectedValueOnce(new Error('keychain unavailable'))
      .mockImplementation(async value => {
        saved = value;
      });
    let foreground: ((state: AppStateStatus) => void) | undefined;
    const listener = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, handler) => {
        foreground = handler;
        return { remove: jest.fn() } as never;
      });
    const store = createAppointmentStore([]);
    const runtime = createAppointmentReminderRuntime(
      async () => store.repository,
    );
    const controller = createNavigationController<AppNavigationRoute>('home');
    controller.registerLeaveGuard(
      controller.getSnapshot().currentRoute.key,
      async () => true,
    );
    let view = await render(
      <AppointmentReminderProvider runtime={runtime}>
        <AppointmentReminderDeliveryHost controller={controller} />
      </AppointmentReminderProvider>,
    );
    await waitFor(() =>
      expect(controller.getSnapshot().currentRoute.name).toBe('daily-report'),
    );
    const route = controller.getSnapshot().currentRoute;
    controller.registerLeaveGuard(route.key, async () => true);
    await act(async () => {
      await controller.requestBack();
    });
    await waitFor(() =>
      expect(dailyReminderIntentStore.write).toHaveBeenCalledTimes(1),
    );
    expect(saved.active).toBe(true);
    expect(runtime.dailyReportTargets.has(route.key)).toBe(true);
    if (trigger === 'foreground') {
      await act(async () => {
        foreground?.('active');
      });
    } else {
      await view.unmount();
      view = await render(
        <AppointmentReminderProvider runtime={runtime}>
          <AppointmentReminderDeliveryHost controller={controller} />
        </AppointmentReminderProvider>,
      );
    }
    await waitFor(() => expect(saved.active).toBe(false));
    expect(runtime.dailyReportTargets.has(route.key)).toBe(false);
    expect(controller.getSnapshot().currentRoute.name).toBe('home');
    await view.unmount();
    jest.mocked(dailyReminderIntentStore.read).mockClear();
    const restarted = await render(
      <AppointmentReminderProvider runtime={runtime}>
        <AppointmentReminderDeliveryHost controller={controller} />
      </AppointmentReminderProvider>,
    );
    await waitFor(() =>
      expect(dailyReminderIntentStore.read).toHaveBeenCalled(),
    );
    expect(controller.getSnapshot().currentRoute.name).toBe('home');
    await restarted.unmount();
    listener.mockRestore();
  },
);
