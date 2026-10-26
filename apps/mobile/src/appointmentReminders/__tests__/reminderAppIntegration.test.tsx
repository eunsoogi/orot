import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert } from 'react-native';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { appointment } from '../../nextVisitQuestions/testSupport/fixtures';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../../routes/appNavigationRoute';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../AppointmentReminderContext';
import { AppointmentReminderControls } from '../AppointmentReminderControls';
import { AppointmentReminderDeliveryHost } from '../AppointmentReminderDeliveryHost';
import { AppointmentPreparationRoute } from '../AppointmentPreparationRoute';
import {
  appointmentReminderPort,
  consumeAppointmentReminderTarget,
  subscribeAppointmentReminderOpened,
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
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
}));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));
jest.mock('../../navigation/NavigationRouteScrollView', () => ({
  NavigationRouteScrollView: require('react-native').ScrollView,
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(appointmentReminderPort.readSelection).mockResolvedValue(null);
  jest.mocked(consumeAppointmentReminderTarget).mockResolvedValue(null);
});

function setup() {
  // A second, earlier appointment proves tap routing cannot silently pick the next visit.
  const earlier = {
    ...appointment,
    id: 'synthetic-earlier',
    clinicLabel: '다른 합성 예약',
    effectiveAt: '2035-06-01T09:00:00Z',
  };
  const store = createAppointmentStore([earlier, appointment]);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  const controller = createNavigationController<AppNavigationRoute>('home');
  const guard = jest.fn(async () => true);
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    guard,
  );
  const plan = buildAppointmentReminder(
    [appointment],
    { appointmentId: appointment.id, leadMinutes: 60 },
    0,
  )!;
  const target = { appointmentId: appointment.id, timeKey: plan.timeKey };
  return { store, runtime, controller, guard, target };
}

it('requires explicit opt-in and recalculates committed edits and cancellation through the app loader', async () => {
  const { store, runtime } = setup();
  await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderControls appointment={appointment} />
    </AppointmentReminderProvider>,
  );
  expect(appointmentReminderPort.requestAuthorization).not.toHaveBeenCalled();
  jest
    .mocked(appointmentReminderPort.writeSelection)
    .mockImplementation(async value => {
      jest
        .mocked(appointmentReminderPort.readSelection)
        .mockResolvedValue(value);
    });
  await fireEvent.press(
    screen.getByTestId(`appointment-reminder-${appointment.id}-60`),
  );
  await waitFor(() =>
    expect(screen.getByText('알림이 설정되었어요.')).toBeTruthy(),
  );
  expect(appointmentReminderPort.replace).toHaveBeenLastCalledWith(
    expect.objectContaining({ appointmentId: appointment.id }),
  );
  const repository = await runtime.load();
  await act(async () => {
    await repository.update(appointment.id, {
      effectiveAt: '2035-06-03T09:30:00Z',
    });
  });
  expect(appointmentReminderPort.replace).toHaveBeenLastCalledWith(
    expect.objectContaining({ fireAt: Date.parse('2035-06-03T08:30:00Z') }),
  );
  await act(async () => {
    await repository.cancel(appointment.id);
  });
  expect(store.cancel).toHaveBeenCalledWith(appointment.id);
  expect(appointmentReminderPort.replace).toHaveBeenLastCalledWith(null);
});

it('drains cold-start and foreground taps through a guarded route for the exact visit', async () => {
  const { runtime, controller, guard, target } = setup();
  jest.mocked(consumeAppointmentReminderTarget).mockResolvedValueOnce(target);
  await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() =>
    expect(controller.getSnapshot().currentRoute.name).toBe(
      'appointment-preparation',
    ),
  );
  expect(guard).toHaveBeenCalledTimes(1);
  expect(
    runtime.targets.get(controller.getSnapshot().currentRoute.key),
  ).toEqual(target);
  jest.mocked(consumeAppointmentReminderTarget).mockResolvedValueOnce(target);
  guard.mockResolvedValueOnce(false);
  controller.registerLeaveGuard(
    controller.getSnapshot().currentRoute.key,
    guard,
  );
  const wake = jest.mocked(subscribeAppointmentReminderOpened).mock.calls[0][0];
  await act(async () => {
    wake();
  });
  expect(controller.getSnapshot().routes).toHaveLength(2);
});

it('does not retry a reminder tap after its own navigation guard is declined', async () => {
  const { runtime, controller, guard, target } = setup();
  guard.mockResolvedValueOnce(false);
  jest.mocked(consumeAppointmentReminderTarget).mockResolvedValueOnce(target);
  await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() => expect(guard).toHaveBeenCalledTimes(1));

  const wake = jest.mocked(subscribeAppointmentReminderOpened).mock.calls[0][0];
  await act(async () => wake());

  expect(guard).toHaveBeenCalledTimes(1);
  expect(runtime.targets.size).toBe(0);
});

it('rejects a tap cancelled while the navigation confirmation is open', async () => {
  const { runtime, store, controller, guard, target } = setup();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  guard.mockImplementationOnce(async () => {
    await store.repository.cancel(appointment.id);
    return true;
  });
  jest.mocked(consumeAppointmentReminderTarget).mockResolvedValueOnce(target);
  await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentReminderDeliveryHost controller={controller} />
    </AppointmentReminderProvider>,
  );
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(controller.getSnapshot().currentRoute.name).toBe('home');
  alert.mockRestore();
});

it('reads reviewed preparation for the target visit and never loads another visit', async () => {
  const { runtime, target } = setup();
  runtime.targets.set('synthetic-route', target);
  const load = jest.fn(async (appointmentId: string) => ({
    status: 'ready' as const,
    appointmentId,
    questions: [],
    caveats: [] as const,
    restorationNotice: '',
  }));
  await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentPreparationRoute
        routeKey="synthetic-route"
        loadSavedQuestions={load}
      />
    </AppointmentReminderProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText(appointment.clinicLabel!)).toBeTruthy(),
  );
  expect(load).toHaveBeenCalledWith(appointment.id);
  expect(screen.queryByText('다른 합성 예약')).toBeNull();
});
