import { render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { appointment } from '../../nextVisitQuestions/testSupport/fixtures';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { ReminderGate } from '../../assistantAppearance/GatedReminderDeliveryHost';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../../appointmentReminders/AppointmentReminderContext';
import { buildAppointmentReminder } from '../../appointmentReminders/reminderPlan';
import {
  consumeAppointmentReminderTarget,
  consumeDailyReminderTarget,
} from '../../appointmentReminders/nativeReminderBridge';
import { dailyReportConversationIntentStore } from '../../aiFeatures/integration/dailyReportConversationIntentStore';
import { dailyReminderIntentStore } from '../../appointmentReminders/dailyReminderIntentStore';
import { nativeReplyNotifications } from '../../replyNotifications/nativeReplyNotifications';

jest.mock('../rootURLBridge', () => ({
  rootURLBridge: {
    peek: jest.fn(async () => null),
    acknowledge: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));
jest.mock('../../replyNotifications/nativeReplyNotifications', () => ({
  nativeReplyNotifications: jest.fn(),
}));
jest.mock('../../appointmentReminders/nativeReminderBridge', () => ({
  appointmentReminderPort: {
    readSelection: jest.fn(async () => null),
    authorizationStatus: jest.fn(async () => 'authorized'),
    replace: jest.fn(async () => undefined),
  },
  consumeAppointmentReminderTarget: jest.fn(async () => null),
  consumeDailyReminderTarget: jest.fn(async () => null),
  acknowledgeDailyReminderTarget: jest.fn(),
  subscribeAppointmentReminderOpened: jest.fn(() => () => {}),
}));
jest.mock('../../appointmentReminders/dailyReminderIntentStore', () => ({
  dailyReminderIntentStore: {
    read: jest.fn(async () => null),
    write: jest.fn(),
  },
}));
jest.mock(
  '../../aiFeatures/integration/dailyReportConversationIntentStore',
  () => ({
    dailyReportConversationIntentStore: {
      read: jest.fn(),
      version: () => 1,
      hasPendingDismissal: () => false,
      retryDismissals: jest.fn(async () => {}),
      dismiss: jest.fn(),
    },
  }),
);

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  jest
    .mocked(nativeReplyNotifications)
    .mockReturnValue({ consumeTarget: jest.fn(async () => null) } as never);
});

test('a cold appointment tap wins over a saved passive conversation restore', async () => {
  jest.mocked(dailyReportConversationIntentStore.read).mockResolvedValue({
    active: true,
    intent: { kind: 'daily-report', entryKey: 'saved', request: {} },
  } as never);
  const plan = buildAppointmentReminder(
    [appointment],
    { appointmentId: appointment.id, leadMinutes: 60 },
    0,
  )!;
  jest.mocked(consumeAppointmentReminderTarget).mockResolvedValueOnce({
    appointmentId: appointment.id,
    timeKey: plan.timeKey,
  });
  const store = createAppointmentStore([appointment]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('root');
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    async () => true,
  );
  const view = await render(
    <AppointmentReminderProvider runtime={runtime}>
      <ReminderGate controller={controller} ready selectTab={() => {}} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() =>
    expect(controller.getSnapshot().currentRoute.name).toBe(
      'appointment-preparation',
    ),
  );
  await waitFor(() => expect(consumeDailyReminderTarget).toHaveBeenCalled());
  expect(controller.getSnapshot().routes).toHaveLength(2);
  expect(
    runtime.targets.get(controller.getSnapshot().currentRoute.key),
  ).toEqual({ appointmentId: appointment.id, timeKey: plan.timeKey });
  expect(dailyReportConversationIntentStore.read).not.toHaveBeenCalled();
  await view.unmount();
});

test('a pending reply prevents passive daily restoration before reply validation', async () => {
  jest.mocked(nativeReplyNotifications).mockReturnValue({
    consumeTarget: jest.fn(async () => ({
      requestId: 'r',
      sessionId: 's',
      messageId: 'm',
      sessionVersion: '1',
    })),
  } as never);
  jest
    .mocked(dailyReminderIntentStore.read)
    .mockResolvedValue({ active: true, entry: {} } as never);
  const runtime = createAppointmentReminderRuntime(
    async () => createAppointmentStore([]).repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('root');
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    async () => true,
  );
  const view = await render(
    <AppointmentReminderProvider runtime={runtime}>
      <ReminderGate controller={controller} ready selectTab={() => {}} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() => expect(consumeDailyReminderTarget).toHaveBeenCalled());
  expect(controller.getSnapshot().routes).toHaveLength(1);
  expect(dailyReminderIntentStore.read).not.toHaveBeenCalled();
  await view.unmount();
});
