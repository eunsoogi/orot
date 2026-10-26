import type { Appointment } from '@orot/storage';
import { appointment } from '../../nextVisitQuestions/testSupport/fixtures';
import { AppointmentReminderCoordinator } from '../reminderCoordinator';
import type {
  AppointmentReminderPort,
  ReminderAuthorization,
} from '../reminderCoordinator';
import type { AppointmentReminderSelection } from '../reminderPlan';

const choice = { appointmentId: appointment.id, leadMinutes: 60 as const };
const now = Date.parse('2035-06-01T00:00:00Z');

function setup(initial: AppointmentReminderSelection | null = choice) {
  let selection = initial;
  let visits: readonly Appointment[] = [appointment];
  const port = {
    readSelection: jest.fn(async () => selection),
    writeSelection: jest.fn(
      async (value: AppointmentReminderSelection | null) => {
        selection = value;
      },
    ),
    authorizationStatus: jest.fn(
      async (): Promise<ReminderAuthorization> => 'authorized',
    ),
    requestAuthorization: jest.fn(
      async (): Promise<ReminderAuthorization> => 'authorized',
    ),
    replace: jest.fn(async () => undefined),
  } satisfies AppointmentReminderPort;
  const load = jest.fn(async () => visits);
  return {
    port,
    load,
    setVisits(value: readonly Appointment[]) {
      visits = value;
    },
    coordinator: new AppointmentReminderCoordinator(load, port, () => now),
  };
}

it('restores an opt-in without requesting notification or Calendar permission', async () => {
  const { coordinator, port } = setup();
  await coordinator.reconcile();
  expect(port.requestAuthorization).not.toHaveBeenCalled();
  expect(port.replace).toHaveBeenLastCalledWith({
    ...choice,
    appointmentStartAt: Date.parse(appointment.effectiveAt),
    fireAt: Date.parse('2035-06-02T08:30:00Z'),
    floating: false,
    timeKey: `instant:${Date.parse(appointment.effectiveAt)}`,
  });
  expect(coordinator.getSnapshot()).toEqual({
    selection: choice,
    status: 'scheduled',
    busy: false,
  });
});

it('does not opt in or read visits during a passive refresh', async () => {
  const { coordinator, port, load } = setup(null);
  await coordinator.reconcile();
  expect(load).not.toHaveBeenCalled();
  expect(port.requestAuthorization).not.toHaveBeenCalled();
  expect(port.replace).toHaveBeenLastCalledWith(null);
});

it('removes the old alert after rescheduling and cancellation', async () => {
  const { coordinator, port, setVisits } = setup();
  await coordinator.reconcile();
  setVisits([{ ...appointment, effectiveAt: '2035-06-04T12:00:00Z' }]);
  await coordinator.reconcile();
  expect(port.replace).toHaveBeenLastCalledWith(
    expect.objectContaining({ fireAt: Date.parse('2035-06-04T11:00:00Z') }),
  );
  setVisits([{ ...appointment, status: 'cancelled' }]);
  await coordinator.reconcile();
  expect(port.replace).toHaveBeenLastCalledWith(null);
  expect(coordinator.getSnapshot().status).toBe('unscheduled');
});

it('never schedules a stale snapshot after an outstanding permission prompt', async () => {
  const { coordinator, port, setVisits } = setup(null);
  let reply!: (value: ReminderAuthorization) => void;
  port.requestAuthorization.mockImplementationOnce(
    () =>
      new Promise<ReminderAuthorization>(resolve => {
        reply = resolve;
      }),
  );
  const selecting = coordinator.select(choice);
  await Promise.resolve();
  setVisits([{ ...appointment, status: 'cancelled' }]);
  const refreshing = coordinator.reconcile();
  reply('authorized');
  await Promise.all([selecting, refreshing]);
  expect(port.replace.mock.calls).toEqual([[null], [null]]);
});

it('leaves opt-in unset when permission is denied and permits opt-out without prompting', async () => {
  const { coordinator, port } = setup(null);
  port.requestAuthorization.mockResolvedValueOnce('denied');
  await coordinator.select(choice);
  expect(port.writeSelection).not.toHaveBeenCalled();
  expect(coordinator.getSnapshot().status).toBe('denied');
  await coordinator.select(null);
  expect(port.requestAuthorization).toHaveBeenCalledTimes(1);
  expect(port.writeSelection).toHaveBeenLastCalledWith(null);
  expect(port.replace).toHaveBeenLastCalledWith(null);
});

it('clears stale alerts when OS authorization is revoked', async () => {
  const { coordinator, port, load } = setup();
  port.authorizationStatus.mockResolvedValueOnce('denied');
  await coordinator.reconcile();
  expect(load).not.toHaveBeenCalled();
  expect(port.replace).toHaveBeenLastCalledWith(null);
  expect(coordinator.getSnapshot().status).toBe('denied');
});

it('exposes failure, clears stale requests and recovers on a later refresh', async () => {
  const { coordinator, port, load } = setup();
  load.mockRejectedValueOnce(new Error('Synthetic database unavailable'));
  await expect(coordinator.reconcile()).rejects.toThrow(
    'Appointment reminders could not be updated.',
  );
  expect(port.replace).toHaveBeenLastCalledWith(null);
  expect(coordinator.getSnapshot().status).toBe('error');
  await coordinator.reconcile();
  expect(coordinator.getSnapshot().status).toBe('scheduled');
});

it('does not report success if scheduling and subsequent cleanup both fail', async () => {
  const { coordinator, port } = setup();
  port.replace.mockRejectedValue(new Error('Synthetic notification failure'));
  await expect(coordinator.reconcile()).rejects.toThrow();
  expect(coordinator.getSnapshot()).toEqual({
    selection: choice,
    status: 'error',
    busy: false,
  });
});

it('clears the previous request after native replacement fails', async () => {
  const { coordinator, port } = setup();
  port.replace.mockRejectedValueOnce(
    new Error('Synthetic notification center add failure'),
  );

  await expect(coordinator.reconcile()).rejects.toThrow(
    'Appointment reminders could not be updated.',
  );
  expect(port.replace).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ appointmentId: appointment.id }),
  );
  expect(port.replace).toHaveBeenNthCalledWith(2, null);
  expect(coordinator.getSnapshot()).toEqual({
    selection: choice,
    status: 'error',
    busy: false,
  });
});
