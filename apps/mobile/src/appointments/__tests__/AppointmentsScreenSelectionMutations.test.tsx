import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { Appointment } from '@orot/storage';
import AppointmentsScreen from '../AppointmentsScreen';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';

const now = Date.parse('2026-10-20T12:00:00Z');

function appointment(
  id: string,
  effectiveAt: number,
  status: Appointment['status'] = 'scheduled',
): Appointment {
  return {
    id,
    effectiveAt: new Date(effectiveAt).toISOString(),
    recordedAt: new Date(now).toISOString(),
    ingestedAt: new Date(now).toISOString(),
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    status,
    clinicLabel: id,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(now);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

/** Calls the explicit destructive choice while keeping row-press behavior observable. */
function confirmCancellation(alert: jest.SpyInstance) {
  const buttons =
    (alert.mock.calls[alert.mock.calls.length - 1]?.[2] as
      | Array<{
          style?: 'default' | 'cancel' | 'destructive';
          onPress?: (value?: string) => void;
        }>
      | undefined) ?? [];
  const confirmation = buttons.find(button => button.style === 'destructive');
  confirmation?.onPress?.();
}

test('leaves details unselected when every appointment is cancelled or past', async () => {
  const store = createAppointmentStore([
    appointment('cancelled', now + 60_000, 'cancelled'),
    appointment('past', now - 60_000),
  ]);

  await render(<AppointmentsScreen repository={store.repository} />);

  const cancelled = await screen.findByTestId('appointment-select-cancelled');
  const past = screen.getByTestId('appointment-select-past');
  expect(cancelled.props.accessibilityState.selected).toBe(false);
  expect(past.props.accessibilityState.selected).toBe(false);
  expect(screen.getByTestId('appointments-selection-prompt')).toBeTruthy();
});

test('keeps an explicitly selected appointment after cancellation', async () => {
  const cancellationAlert = jest
    .spyOn(Alert, 'alert')
    .mockImplementation(() => undefined);
  const store = createAppointmentStore([
    appointment('current', now + 60_000),
    appointment('following', now + 2 * 60_000),
  ]);
  await render(<AppointmentsScreen repository={store.repository} />);

  const current = await screen.findByTestId('appointment-select-current');
  await fireEvent.press(current);
  expect(screen.getByTestId('appointment-next-visit-current')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('appointment-cancel-current'));
  expect(cancellationAlert).toHaveBeenCalledTimes(1);
  await act(async () => confirmCancellation(cancellationAlert));

  expect(
    await screen.findByTestId('appointment-next-visit-following'),
  ).toBeTruthy();
  expect(
    screen.getByTestId('appointment-select-current').props.accessibilityState,
  ).toEqual({ selected: true });
  expect(screen.getByTestId('appointment-status-current')).toHaveTextContent(
    '취소됨',
  );

  await fireEvent.press(screen.getByTestId('appointment-add'));
  await fireEvent.changeText(
    screen.getByTestId('appointment-clinic-input'),
    'new visit',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-date-input'),
    '2026-10-20',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-time-input'),
    '12:03',
  );
  await fireEvent.press(screen.getByTestId('appointment-save'));

  expect(await screen.findByTestId('appointment-select-manual-1')).toBeTruthy();
  expect(
    screen.getByTestId('appointment-select-current').props.accessibilityState,
  ).toEqual({ selected: true });
  expect(
    screen.getByTestId('appointment-select-manual-1').props.accessibilityState,
  ).toEqual({ selected: false });
});

test('moves an automatic selection to the following visit after cancellation', async () => {
  const cancellationAlert = jest
    .spyOn(Alert, 'alert')
    .mockImplementation(() => undefined);
  const store = createAppointmentStore([
    appointment('current', now + 60_000),
    appointment('following', now + 2 * 60_000),
  ]);
  await render(<AppointmentsScreen repository={store.repository} />);

  const current = await screen.findByTestId('appointment-select-current');
  expect(current.props.accessibilityState.selected).toBe(true);
  await fireEvent.press(screen.getByTestId('appointment-cancel-current'));
  expect(cancellationAlert).toHaveBeenCalledTimes(1);
  await act(async () => confirmCancellation(cancellationAlert));

  expect(
    await screen.findByTestId('appointment-next-visit-following'),
  ).toBeTruthy();
  expect(
    screen.getByTestId('appointment-select-current').props.accessibilityState
      .selected,
  ).toBe(false);
  expect(
    screen.getByTestId('appointment-select-following').props.accessibilityState
      .selected,
  ).toBe(true);
});

test('moves an automatic selection when its appointment is rescheduled later', async () => {
  const store = createAppointmentStore([
    appointment('current', now + 60_000),
    appointment('following', now + 2 * 60_000),
  ]);
  await render(<AppointmentsScreen repository={store.repository} />);

  await screen.findByTestId('appointment-next-visit-current');
  expect(
    screen.getByTestId('appointment-select-current').props.accessibilityState
      .selected,
  ).toBe(true);
  await fireEvent.press(screen.getByTestId('appointment-edit-current'));
  await fireEvent.changeText(
    screen.getByTestId('appointment-date-input'),
    '2026-10-21',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-time-input'),
    '12:00',
  );
  // Rescheduling the default can change which visit is next without changing manual choices.
  await fireEvent.press(screen.getByTestId('appointment-save'));

  expect(
    await screen.findByTestId('appointment-next-visit-following'),
  ).toBeTruthy();
  expect(screen.queryByTestId('appointment-next-visit-current')).toBeNull();
  expect(
    screen.getByTestId('appointment-select-current').props.accessibilityState
      .selected,
  ).toBe(false);
  expect(
    screen.getByTestId('appointment-select-following').props.accessibilityState
      .selected,
  ).toBe(true);
});
