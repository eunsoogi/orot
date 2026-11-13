import { act, render, waitFor } from '@testing-library/react-native';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../AppointmentReminderContext';
import { AppointmentReminderDeliveryHost } from '../AppointmentReminderDeliveryHost';
import { dailyReminderIntentStore } from '../dailyReminderIntentStore';
import { consumeDailyReminderTarget } from '../nativeReminderBridge';

jest.mock('../nativeReminderBridge', () => ({
  appointmentReminderPort: {
    readSelection: jest.fn(async () => null),
    authorizationStatus: jest.fn(async () => 'authorized'),
    replace: jest.fn(async () => {}),
  },
  consumeAppointmentReminderTarget: jest.fn(async () => null),
  consumeDailyReminderTarget: jest.fn(),
  acknowledgeDailyReminderTarget: jest.fn(),
  subscribeAppointmentReminderOpened: jest.fn(() => () => {}),
}));
jest.mock('../dailyReminderIntentStore', () => ({
  dailyReminderIntentStore: { read: jest.fn(), write: jest.fn() },
}));
jest.mock(
  '../../aiFeatures/integration/dailyReportConversationIntentStore',
  () => ({
    dailyReportConversationIntentStore: {
      read: jest.fn(async () => null),
      retryDismissals: jest.fn(async () => {}),
      version: () => 0,
      hasPendingDismissal: () => false,
      dismiss: jest.fn(),
    },
  }),
);

test('a busy explicit daily tap does not immediately restore and re-prompt itself', async () => {
  let saved: unknown = null;
  jest
    .mocked(dailyReminderIntentStore.read)
    .mockImplementation(async () => saved as never);
  jest
    .mocked(dailyReminderIntentStore.write)
    .mockImplementation(async value => {
      saved = value;
    });
  jest.mocked(consumeDailyReminderTarget).mockResolvedValue({
    kind: 'daily_report',
    deliveryTimestamp: '1700000000',
  });
  const runtime = createAppointmentReminderRuntime(
    async () => createAppointmentStore([]).repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('root');
  const confirm = jest.fn(async () => false);
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    confirm,
  );
  const view = await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  try {
    await waitFor(() =>
      expect(dailyReminderIntentStore.write).toHaveBeenCalledTimes(1),
    );
    await act(async () => {
      for (let index = 0; index < 20; index += 1) await Promise.resolve();
    });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().routes).toHaveLength(1);
  } finally {
    await view.unmount();
  }
});
