import { act, render, screen } from '@testing-library/react-native';
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

afterEach(() => jest.useRealTimers());

test('moves the automatic selection when the current visit reaches its end', async () => {
  const current = {
    ...appointment('current', now - 60_000),
    endsAt: new Date(now + 5_000).toISOString(),
  };
  const store = createAppointmentStore([
    current,
    appointment('following', now + 60_000),
  ]);
  await render(<AppointmentsScreen repository={store.repository} />);

  await screen.findByTestId('appointment-select-current');
  expect(
    screen.getByTestId('appointment-select-current').props.accessibilityState
      .selected,
  ).toBe(true);
  expect(screen.getByTestId('appointment-next-visit-current')).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(4_999));
  expect(screen.getByTestId('appointment-next-visit-current')).toBeTruthy();
  expect(
    screen.getByTestId('appointment-select-current').props.accessibilityState
      .selected,
  ).toBe(true);

  await act(async () => jest.advanceTimersByTime(1));
  expect(screen.getByTestId('appointment-next-visit-following')).toBeTruthy();
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
