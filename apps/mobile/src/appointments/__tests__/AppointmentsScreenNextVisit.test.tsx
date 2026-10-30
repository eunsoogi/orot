import { act, fireEvent, render, screen } from '@testing-library/react-native';
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

test('marks the actual next visit independently of a selected history record', async () => {
  const store = createAppointmentStore([
    appointment('cancelled', now + 60_000, 'cancelled'),
    appointment('past', now - 60_000),
    appointment('next', now + 60 * 60_000),
    appointment('later', now + 2 * 60 * 60_000),
  ]);

  await render(<AppointmentsScreen repository={store.repository} />);

  const cancelled = await screen.findByTestId('appointment-select-cancelled');
  const next = screen.getByTestId('appointment-select-next');
  expect(screen.getByTestId('appointment-next-visit-next')).toHaveTextContent(
    '다음 진료',
  );
  expect(screen.queryByTestId('appointment-next-visit-later')).toBeNull();
  expect(screen.getByTestId('appointments-section-upcoming')).toBeTruthy();
  expect(screen.getByTestId('appointments-section-history')).toBeTruthy();
  expect(screen.getByText('지난 예약')).toBeTruthy();

  await fireEvent.press(cancelled);
  expect(cancelled.props.accessibilityState).toEqual({ selected: true });
  expect(next.props.accessibilityState).toEqual({ selected: false });
  expect(screen.getByTestId('appointment-next-visit-next')).toBeTruthy();
});

test('moves the next-visit marker after cancellation and keeps details selected', async () => {
  const store = createAppointmentStore([
    appointment('current', now + 60_000),
    appointment('following', now + 2 * 60_000),
  ]);
  await render(<AppointmentsScreen repository={store.repository} />);

  const current = await screen.findByTestId('appointment-select-current');
  await fireEvent.press(current);
  expect(screen.getByTestId('appointment-next-visit-current')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('appointment-cancel-current'));

  expect(
    await screen.findByTestId('appointment-next-visit-following'),
  ).toBeTruthy();
  expect(screen.queryByTestId('appointment-next-visit-current')).toBeNull();
  expect(
    screen.getByTestId('appointment-select-current').props.accessibilityState,
  ).toEqual({ selected: true });
  expect(screen.getByTestId('appointment-status-current')).toHaveTextContent(
    '취소됨',
  );
});

test('moves the next-visit marker when the selected visit is rescheduled later', async () => {
  const store = createAppointmentStore([
    appointment('current', now + 60_000),
    appointment('following', now + 2 * 60_000),
  ]);
  await render(<AppointmentsScreen repository={store.repository} />);

  await screen.findByTestId('appointment-next-visit-current');
  await fireEvent.press(screen.getByTestId('appointment-edit-current'));
  await fireEvent.changeText(
    screen.getByTestId('appointment-date-input'),
    '2026-10-21',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-time-input'),
    '12:00',
  );
  // Move the selected record past another visit so next-visit identity must change independently.
  await fireEvent.press(screen.getByTestId('appointment-save'));

  expect(
    await screen.findByTestId('appointment-next-visit-following'),
  ).toBeTruthy();
  expect(screen.queryByTestId('appointment-next-visit-current')).toBeNull();
  expect(
    screen.getByTestId('appointment-select-current').props.accessibilityState,
  ).toEqual({ selected: true });
  expect(screen.getByTestId('appointment-status-current')).toHaveTextContent(
    '일정 변경',
  );
});

test('refreshes its records when the retained route regains focus', async () => {
  const store = createAppointmentStore([appointment('next', now + 60_000)]);
  const rendered = await render(
    <AppointmentsScreen active={false} repository={store.repository} />,
  );
  expect(store.repository.list).not.toHaveBeenCalled();

  await rendered.rerender(
    <AppointmentsScreen active repository={store.repository} />,
  );
  expect(await screen.findByTestId('appointment-next-visit-next')).toBeTruthy();
  expect(store.repository.list).toHaveBeenCalledTimes(1);
});

test('moves to the following visit at the current visit end boundary', async () => {
  const current = {
    ...appointment('current', now - 60_000),
    endsAt: new Date(now + 5_000).toISOString(),
  };
  const store = createAppointmentStore([
    current,
    appointment('following', now + 60_000),
  ]);
  await render(<AppointmentsScreen repository={store.repository} />);

  expect(
    await screen.findByTestId('appointment-next-visit-current'),
  ).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(4_999));
  expect(screen.getByTestId('appointment-next-visit-current')).toBeTruthy();
  await act(async () => jest.advanceTimersByTime(1));
  expect(screen.getByTestId('appointment-next-visit-following')).toBeTruthy();
  expect(screen.queryByTestId('appointment-next-visit-current')).toBeNull();
});
