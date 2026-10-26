import type { AppointmentRepository } from '@orot/storage';
import { appointment } from '../../nextVisitQuestions/testSupport/fixtures';
import { withAppointmentReminders } from '../reminderRepository';

function setup() {
  const repository = {
    list: jest.fn(async () => [appointment]),
    create: jest.fn(async () => appointment),
    confirmCalendarEvent: jest.fn(async () => appointment),
    reconfirmCalendarEvent: jest.fn(async () => appointment),
    update: jest.fn(async () => appointment),
    cancel: jest.fn(async () => appointment),
  } satisfies AppointmentRepository;
  const reminders = { reconcile: jest.fn(async () => undefined) };
  return {
    repository,
    reminders,
    decorated: withAppointmentReminders(repository, reminders),
  };
}

it('recalculates after the appointment update commits', async () => {
  const { repository, reminders, decorated } = setup();
  reminders.reconcile.mockImplementation(async () => {
    expect(repository.update).toHaveBeenCalledWith(appointment.id, {
      effectiveAt: '2035-06-03T09:30:00Z',
    });
  });
  await expect(
    decorated.update(appointment.id, {
      effectiveAt: '2035-06-03T09:30:00Z',
    }),
  ).resolves.toBe(appointment);
  expect(reminders.reconcile).toHaveBeenCalledTimes(1);
});

it('reconciles cancellation while preserving a committed result if notification cleanup fails', async () => {
  const { repository, reminders, decorated } = setup();
  reminders.reconcile.mockRejectedValueOnce(new Error('Synthetic OS failure'));
  await expect(decorated.cancel(appointment.id)).resolves.toBe(appointment);
  expect(repository.cancel).toHaveBeenCalledWith(appointment.id);
  expect(reminders.reconcile).toHaveBeenCalledTimes(1);
});

it('does not change reminders when the appointment mutation fails', async () => {
  const { repository, reminders, decorated } = setup();
  repository.cancel.mockRejectedValueOnce(
    new Error('Synthetic storage failure'),
  );
  await expect(decorated.cancel(appointment.id)).rejects.toThrow(
    'Synthetic storage failure',
  );
  expect(reminders.reconcile).not.toHaveBeenCalled();
});

it('preserves the local read contract without adding permission or mutation side effects', async () => {
  const { repository, reminders, decorated } = setup();
  await expect(decorated.list()).resolves.toEqual([appointment]);
  expect(repository.list).toHaveBeenCalledTimes(1);
  expect(reminders.reconcile).not.toHaveBeenCalled();
});
