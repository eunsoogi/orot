import { fireEvent, render, screen } from '@testing-library/react-native';
import type {
  Appointment,
  AppointmentChanges,
  AppointmentRepository,
  ManualAppointmentInput,
} from '@orot/storage';
import App from '../App';

test('shows the initial welcome state', async () => {
  await render(<App />);

  expect(screen.getByRole('header', { name: 'Orot workspace ready' })).toBeTruthy();
  expect(screen.getByText('A simple foundation for Orot.')).toBeTruthy();
});

test('updates the welcome message when the user gets started', async () => {
  await render(<App />);

  await fireEvent.press(screen.getByRole('button', { name: 'Get started' }));

  expect(screen.getByText('You are ready to build.')).toBeTruthy();
});

function createAppointmentStore() {
  let appointments: Appointment[] = [];
  let nextId = 0;
  const recordedAt = '2026-02-03T09:00:00Z';
  const list = jest.fn(async () => [...appointments]);
  const create = jest.fn(async (input: ManualAppointmentInput) => {
    const appointment = {
      id: 'manual-' + ++nextId,
      ...input,
      status: 'scheduled',
      recordedAt,
      ingestedAt: recordedAt,
      provenance: { origin: 'user_reported', sourceRecordIds: [] },
      reviewState: { status: 'unreviewed' },
    } as Appointment;
    appointments = [...appointments, appointment];
    return appointment;
  });
  const update = jest.fn(async (id: string, changes: AppointmentChanges) => {
    const current = appointments.find(item => item.id === id);
    if (!current) throw new Error('Appointment not found.');
    const changed: Appointment = {
      ...current,
      ...changes,
      status:
        changes.effectiveAt && changes.effectiveAt !== current.effectiveAt
          ? 'rescheduled'
          : current.status,
      note: changes.note === null ? undefined : changes.note ?? current.note,
      endsAt: changes.endsAt === null ? undefined : changes.endsAt ?? current.endsAt,
      recordedAt,
      ingestedAt: recordedAt,
    };
    appointments = appointments.map(item => (item.id === id ? changed : item));
    return changed;
  });
  const cancel = jest.fn(async (id: string) => {
    const current = appointments.find(item => item.id === id);
    if (!current) throw new Error('Appointment not found.');
    const cancelled: Appointment = { ...current, status: 'cancelled', recordedAt, ingestedAt: recordedAt };
    appointments = appointments.map(item => (item.id === id ? cancelled : item));
    return cancelled;
  });
  return {
    repository: { list, create, update, cancel } as AppointmentRepository,
    create,
    update,
    cancel,
  };
}

test('creates, edits, and cancels an appointment from the user-facing screen', async () => {
  const store = createAppointmentStore();
  await render(<App loadAppointments={async () => store.repository} />);

  await fireEvent.press(screen.getByTestId('open-appointments'));
  await screen.findByTestId('appointments-empty');
  await fireEvent.press(screen.getByTestId('appointment-add'));
  await fireEvent.changeText(screen.getByTestId('appointment-clinic-input'), 'Cardiology clinic');
  await fireEvent.changeText(screen.getByTestId('appointment-date-input'), '2027-06-02');
  await fireEvent.changeText(screen.getByTestId('appointment-time-input'), '09:45');
  await fireEvent.changeText(screen.getByTestId('appointment-note-input'), 'Bring the results.');
  await fireEvent.press(screen.getByTestId('appointment-save'));

  expect(store.create).toHaveBeenCalledWith({
    effectiveAt: expect.any(String),
    clinicLabel: 'Cardiology clinic',
    note: 'Bring the results.',
  });
  expect(await screen.findByTestId('appointment-status-manual-1')).toHaveTextContent('Scheduled');

  await fireEvent.press(screen.getByTestId('appointment-edit-manual-1'));
  await fireEvent.changeText(screen.getByTestId('appointment-clinic-input'), 'Neurology clinic');
  await fireEvent.changeText(screen.getByTestId('appointment-date-input'), '2027-06-03');
  await fireEvent.changeText(screen.getByTestId('appointment-time-input'), '10:15');
  await fireEvent.press(screen.getByTestId('appointment-save'));
  expect(await screen.findByTestId('appointment-clinic-manual-1')).toHaveTextContent('Neurology clinic');
  expect(screen.getByTestId('appointment-status-manual-1')).toHaveTextContent('Rescheduled');

  await fireEvent.press(screen.getByTestId('appointment-cancel-manual-1'));
  expect(await screen.findByTestId('appointment-status-manual-1')).toHaveTextContent('Cancelled');
  expect(screen.queryByTestId('appointment-cancel-manual-1')).toBeNull();
});
