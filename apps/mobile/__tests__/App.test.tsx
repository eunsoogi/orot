import { fireEvent, render, screen } from '@testing-library/react-native';
import { SymptomEntrySchema } from '@orot/storage';
import type { SymptomJournalRepository } from '../src/symptoms/localRepository';
import type {
  Appointment,
  AppointmentChanges,
  AppointmentRepository,
  ManualAppointmentInput,
} from '@orot/storage';
import { toSymptomTimestamp } from '../src/symptoms/dateTime';
import App from '../App';

test('shows the initial welcome state', async () => {
  await render(<App />);

  expect(
    screen.getByRole('header', { name: 'Orot workspace ready' }),
  ).toBeTruthy();
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
      endsAt:
        changes.endsAt === null ? undefined : changes.endsAt ?? current.endsAt,
      recordedAt,
      ingestedAt: recordedAt,
    };
    appointments = appointments.map(item => (item.id === id ? changed : item));
    return changed;
  });
  const cancel = jest.fn(async (id: string) => {
    const current = appointments.find(item => item.id === id);
    if (!current) throw new Error('Appointment not found.');
    const cancelled: Appointment = {
      ...current,
      status: 'cancelled',
      recordedAt,
      ingestedAt: recordedAt,
    };
    appointments = appointments.map(item =>
      item.id === id ? cancelled : item,
    );
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
  await fireEvent.changeText(
    screen.getByTestId('appointment-clinic-input'),
    'Cardiology clinic',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-date-input'),
    '2027-06-02',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-time-input'),
    '09:45',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-note-input'),
    'Bring the results.',
  );
  await fireEvent.press(screen.getByTestId('appointment-save'));

  expect(store.create).toHaveBeenCalledWith({
    effectiveAt: expect.any(String),
    clinicLabel: 'Cardiology clinic',
    note: 'Bring the results.',
  });
  expect(
    await screen.findByTestId('appointment-status-manual-1'),
  ).toHaveTextContent('Scheduled');

  await fireEvent.press(screen.getByTestId('appointment-edit-manual-1'));
  await fireEvent.changeText(
    screen.getByTestId('appointment-clinic-input'),
    'Neurology clinic',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-date-input'),
    '2027-06-03',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-time-input'),
    '10:15',
  );
  await fireEvent.press(screen.getByTestId('appointment-save'));
  expect(
    await screen.findByTestId('appointment-clinic-manual-1'),
  ).toHaveTextContent('Neurology clinic');
  expect(screen.getByTestId('appointment-status-manual-1')).toHaveTextContent(
    'Rescheduled',
  );

  await fireEvent.press(screen.getByTestId('appointment-cancel-manual-1'));
  expect(
    await screen.findByTestId('appointment-status-manual-1'),
  ).toHaveTextContent('Cancelled');
  expect(screen.queryByTestId('appointment-cancel-manual-1')).toBeNull();
});

test('opens the symptom journal from the home screen without changing appointments navigation', async () => {
  const entry = SymptomEntrySchema.parse({
    id: 'synthetic-symptom-1',
    effectiveAt: '2026-04-20T08:30:00Z',
    recordedAt: '2026-05-01T12:00:00Z',
    ingestedAt: '2026-05-01T12:00:00Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    description: 'Synthetic hand tingling',
    severity: 5,
    status: 'active',
  });
  const journal: SymptomJournalRepository = {
    list: jest.fn(async () => [entry]),
    create: jest.fn(async () => entry),
    update: jest.fn(async () => entry),
    resolve: jest.fn(async () => entry),
  };
  await render(<App loadSymptoms={async () => journal} />);

  await fireEvent.press(screen.getByTestId('symptoms-open'));
  expect(await screen.findByTestId('symptoms-title')).toHaveTextContent(
    'Symptoms',
  );
  expect(
    await screen.findByTestId('symptom-' + entry.id + '-description'),
  ).toHaveTextContent('Synthetic hand tingling');

  await fireEvent.press(screen.getByTestId('symptom-filter-active'));
  expect(journal.list).toHaveBeenLastCalledWith({ status: 'active' });

  await fireEvent.press(screen.getByTestId('symptoms-back'));
  expect(
    screen.getByRole('header', { name: 'Orot workspace ready' }),
  ).toBeTruthy();
  expect(screen.getByTestId('open-appointments')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('symptoms-open'));
  expect(await screen.findByTestId('symptom-filter-active')).toBeTruthy();
  expect(
    screen.getByTestId('symptom-filter-active').props.accessibilityState,
  ).toEqual({
    selected: true,
  });
  expect(journal.list).toHaveBeenLastCalledWith({ status: 'active' });

  await fireEvent.changeText(
    screen.getByTestId('symptom-filter-from-date'),
    '2026-04-20',
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-filter-from-time'),
    '08:30',
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-filter-through-date'),
    '2026-04-20',
  );
  await fireEvent.changeText(
    screen.getByTestId('symptom-filter-through-time'),
    '09:30',
  );
  await fireEvent.press(screen.getByTestId('symptom-filter-apply'));
  const fromOnsetAt = toSymptomTimestamp('2026-04-20', '08:30');
  const throughOnsetAt = toSymptomTimestamp('2026-04-20', '09:30');
  if (!fromOnsetAt || !throughOnsetAt) {
    throw new Error('The test time range should be valid.');
  }
  const expectedFilter = { status: 'active', fromOnsetAt, throughOnsetAt };
  expect(journal.list).toHaveBeenLastCalledWith(expectedFilter);

  await fireEvent.press(screen.getByTestId('symptoms-back'));
  await fireEvent.press(screen.getByTestId('symptoms-open'));
  expect(await screen.findByTestId('symptom-filter-active')).toBeTruthy();
  expect(screen.getByTestId('symptom-filter-from-date').props.value).toBe(
    '2026-04-20',
  );
  expect(screen.getByTestId('symptom-filter-from-time').props.value).toBe(
    '08:30',
  );
  expect(screen.getByTestId('symptom-filter-through-date').props.value).toBe(
    '2026-04-20',
  );
  expect(screen.getByTestId('symptom-filter-through-time').props.value).toBe(
    '09:30',
  );
  expect(journal.list).toHaveBeenLastCalledWith(expectedFilter);
});
