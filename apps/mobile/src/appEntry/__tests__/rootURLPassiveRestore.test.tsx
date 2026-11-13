import { render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import { ReminderGate } from '../../assistantAppearance/GatedReminderDeliveryHost';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../../appointmentReminders/AppointmentReminderContext';
import { dailyReminderIntentStore } from '../../appointmentReminders/dailyReminderIntentStore';
import { parseDailyReminderEntry } from '../../appointmentReminders/dailyReminderDelivery';
import { consumeDailyReminderTarget } from '../../appointmentReminders/nativeReminderBridge';
import { rootURLBridge } from '../rootURLBridge';

jest.mock('../rootURLBridge', () => ({
  rootURLBridge: {
    peek: jest.fn(),
    acknowledge: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
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
  dailyReminderIntentStore: { read: jest.fn(), write: jest.fn(async () => {}) },
}));

test('a cold root URL wins over a saved passive daily restore without losing the inbox', async () => {
  Object.defineProperty(AppState, 'currentState', {
    configurable: true,
    value: 'active',
  });
  let pending: unknown = { id: 'url', destination: 'records' };
  jest.mocked(rootURLBridge.peek).mockImplementation(async () => pending);
  jest.mocked(rootURLBridge.acknowledge).mockImplementation(async () => {
    pending = null;
  });
  const entry = parseDailyReminderEntry(
    { kind: 'daily_report', deliveryTimestamp: '1700000000' },
    'Asia/Seoul',
  )!;
  jest
    .mocked(dailyReminderIntentStore.read)
    .mockResolvedValue({ entry, active: true });
  const store = createAppointmentStore([]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('root');
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    async () => true,
  );
  const selectTab = jest.fn();
  const view = await render(
    <AppointmentReminderProvider runtime={runtime}>
      <ReminderGate controller={controller} ready selectTab={selectTab} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() => expect(selectTab).toHaveBeenCalledWith('records'));
  await waitFor(() => expect(consumeDailyReminderTarget).toHaveBeenCalled());
  expect(controller.getSnapshot().currentRoute.name).toBe('root');
  expect(controller.getSnapshot().routes).toHaveLength(1);
  expect(selectTab).toHaveBeenCalledTimes(1);
  expect(dailyReminderIntentStore.write).not.toHaveBeenCalled();
  await view.unmount();
});
