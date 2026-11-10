import { act, render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { appointment } from '../../nextVisitQuestions/testSupport/fixtures';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { dailyReportConversationIntentStore } from '../../aiFeatures/integration/dailyReportConversationIntentStore';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../AppointmentReminderContext';
import { AppointmentReminderDeliveryHost } from '../AppointmentReminderDeliveryHost';
import { dailyReminderIntentStore } from '../dailyReminderIntentStore';
import { parseDailyReminderEntry } from '../dailyReminderDelivery';
import { buildAppointmentReminder } from '../reminderPlan';
import { consumeAppointmentReminderTarget } from '../nativeReminderBridge';

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

test.each(['dismissal locked', 'read locked', 'unlocked'] as const)(
  'daily cleanup %s neither loops appointment guards nor loses pending conversation',
  async mode => {
    jest.clearAllMocks();
    const entry = parseDailyReminderEntry(
      { kind: 'daily_report', deliveryTimestamp: '1700000000' },
      'Asia/Seoul',
    )!;
    let saved = { entry, active: true };
    jest
      .mocked(dailyReminderIntentStore.read)
      .mockImplementation(async () => saved);
    let rejectWrite = true;
    jest
      .mocked(dailyReminderIntentStore.write)
      .mockImplementation(async value => {
        if (rejectWrite) throw new Error('locked');
        saved = value;
      });
    let releaseConversation!: () => void;
    let conversationLocked = false;
    let readLocked = false;
    const retry = jest
      .spyOn(dailyReportConversationIntentStore, 'retryDismissals')
      .mockImplementation(async () => {
        if (conversationLocked) throw new Error('locked');
      });
    const conversationReady = new Promise<void>(resolve => {
      releaseConversation = resolve;
    });
    const conversation = {
      kind: 'daily-report' as const,
      entryKey: 'daily-conversation:pending',
      request: {
        localDate: '2023-11-15',
        timeZone: 'Asia/Seoul',
        requestedAt: '2023-11-15T03:00:00Z',
      },
    };
    const read = jest
      .spyOn(dailyReportConversationIntentStore, 'read')
      .mockImplementation(async () => {
        await conversationReady;
        if (readLocked) throw new Error('locked');
        return { intent: conversation, active: true };
      });
    let foreground: ((state: AppStateStatus) => void) | undefined;
    const listener = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, handler) => {
        foreground = handler;
        return { remove: jest.fn() } as never;
      });
    const store = createAppointmentStore([appointment]);
    const runtime = createAppointmentReminderRuntime(
      async () => store.repository,
    );
    const controller = createNavigationController<AppNavigationRoute>('home');
    const home = controller.getSnapshot().currentRoute;
    controller.registerLeaveGuard(home.key, async () => true);
    const view = await render(
      <AppointmentReminderProvider runtime={runtime}>
        <AppointmentReminderDeliveryHost controller={controller} />
      </AppointmentReminderProvider>,
    );
    await waitFor(() =>
      expect(controller.getSnapshot().currentRoute.name).toBe('daily-report'),
    );
    const daily = controller.getSnapshot().currentRoute;
    controller.registerLeaveGuard(daily.key, async () => true);
    await act(async () => {
      await controller.requestBack();
    });
    await waitFor(() =>
      expect(dailyReminderIntentStore.write).toHaveBeenCalledTimes(1),
    );
    expect(runtime.dailyReportTargets.has(daily.key)).toBe(true);
    releaseConversation();
    let finishGuard!: (allowed: boolean) => void;
    const guard = jest
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishGuard = resolve;
          }),
      )
      .mockImplementation(() => new Promise(() => {}));
    controller.registerLeaveGuard(home.key, guard);
    const plan = buildAppointmentReminder(
      [appointment],
      { appointmentId: appointment.id, leadMinutes: 60 },
      0,
    )!;
    if (mode === 'dismissal locked') conversationLocked = true;
    if (mode === 'read locked') readLocked = true;
    if (mode !== 'unlocked')
      jest.mocked(consumeAppointmentReminderTarget).mockResolvedValueOnce({
        appointmentId: appointment.id,
        timeKey: plan.timeKey,
      });
    if (mode === 'unlocked') {
      rejectWrite = false;
      controller.registerLeaveGuard(home.key, async () => true);
    }
    retry.mockClear();
    await act(async () => {
      foreground?.('active');
    });
    if (mode !== 'unlocked') {
      await waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(retry).toHaveBeenCalled());
      await act(async () => {
        await new Promise<void>(resolve => setImmediate(resolve));
        finishGuard(false);
        await new Promise<void>(resolve => setImmediate(resolve));
      });
      expect(guard).toHaveBeenCalledTimes(1);
      expect(dailyReminderIntentStore.write).toHaveBeenCalledTimes(2);
      expect(runtime.dailyReportTargets.has(daily.key)).toBe(true);
      expect(controller.getSnapshot().currentRoute.key).toBe(home.key);
    } else {
      await waitFor(() => expect(saved.active).toBe(false));
      await waitFor(() =>
        expect(runtime.dailyConversationTargets.size).toBe(1),
      );
    }
    await view.unmount();
    listener.mockRestore();
    read.mockRestore();
    retry.mockRestore();
  },
);
