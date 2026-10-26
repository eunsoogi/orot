import { act, render, waitFor } from '@testing-library/react-native';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { appointment } from '../../nextVisitQuestions/testSupport/fixtures';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../AppointmentReminderContext';
import { AppointmentReminderDeliveryHost } from '../AppointmentReminderDeliveryHost';
import {
  appointmentReminderPort,
  consumeAppointmentReminderTarget,
} from '../nativeReminderBridge';
import { buildAppointmentReminder } from '../reminderPlan';

jest.mock('../nativeReminderBridge', () => ({
  appointmentReminderPort: {
    readSelection: jest.fn(async () => null),
    writeSelection: jest.fn(async () => undefined),
    requestAuthorization: jest.fn(async () => 'authorized'),
    authorizationStatus: jest.fn(async () => 'authorized'),
    replace: jest.fn(async () => undefined),
  },
  consumeAppointmentReminderTarget: jest.fn(async () => null),
  subscribeAppointmentReminderOpened: jest.fn(() => () => {}),
}));

function deferred<Value>() {
  let resolve: (value: Value) => void = () => {};
  const promise = new Promise<Value>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(appointmentReminderPort.readSelection).mockResolvedValue(null);
  jest.mocked(consumeAppointmentReminderTarget).mockResolvedValue(null);
});

it('retries a reminder tap after an already-pending navigation guard settles', async () => {
  const store = createAppointmentStore([appointment]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('home');
  const home = controller.getSnapshot().currentRoute;
  const tabGuard = jest.fn(async () => true);
  controller.registerLeaveGuard(home.key, tabGuard);
  const targetPlan = buildAppointmentReminder(
    [appointment],
    { appointmentId: appointment.id, leadMinutes: 60 },
    0,
  )!;
  const target = {
    appointmentId: appointment.id,
    timeKey: targetPlan.timeKey,
  };
  const activeRoute = controller.push('appointment-preparation');
  if (!activeRoute)
    throw new Error('The active test route could not be pushed.');

  const activeGuard = deferred<boolean>();
  controller.registerLeaveGuard(activeRoute.key, () => activeGuard.promise);
  const activeTransition = controller.requestBack();
  expect(controller.getSnapshot().isTransitioning).toBe(true);

  const appointmentLoad = deferred<Awaited<ReturnType<typeof runtime.list>>>();
  const list = jest
    .spyOn(runtime, 'list')
    .mockReturnValue(appointmentLoad.promise);
  let appointmentReadReleased = false;
  const busyDeliveryAttempt = deferred<void>();
  const getSnapshot = controller.getSnapshot;
  jest.spyOn(controller, 'getSnapshot').mockImplementation(() => {
    const snapshot = getSnapshot();
    if (appointmentReadReleased && snapshot.isTransitioning) {
      busyDeliveryAttempt.resolve();
    }
    return snapshot;
  });
  const requestTabSwitch = controller.requestTabSwitch;
  jest.spyOn(controller, 'requestTabSwitch').mockImplementation(() => {
    if (appointmentReadReleased && getSnapshot().isTransitioning) {
      busyDeliveryAttempt.resolve();
    }
    return requestTabSwitch();
  });

  jest.mocked(consumeAppointmentReminderTarget).mockResolvedValueOnce(target);
  await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

  appointmentReadReleased = true;
  await act(async () => appointmentLoad.resolve([appointment]));
  await busyDeliveryAttempt.promise;
  expect(getSnapshot().isTransitioning).toBe(true);

  await act(async () => {
    activeGuard.resolve(true);
    await expect(activeTransition).resolves.toBe(true);
  });
  await waitFor(() => {
    expect(getSnapshot().currentRoute.name).toBe('appointment-preparation');
    expect(getSnapshot().currentRoute.key).not.toBe(activeRoute.key);
  });
  expect(runtime.targets.get(getSnapshot().currentRoute.key)).toEqual(target);
});
