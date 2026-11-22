import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import type { Appointment } from '@orot/storage';
import AppointmentsScreen from '../AppointmentsScreen';
import { appColors } from '../../layout/appColors';
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
  expect(cancelled.props.accessibilityState).toEqual({ selected: false });
  expect(next.props.accessibilityState).toEqual({ selected: true });
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

  expect(cancellationAlert).toHaveBeenCalledWith(
    '예약을 취소할까요?',
    'current 예약을 취소해요. 취소 후에도 예약 내역에서 확인할 수 있어요.',
    expect.arrayContaining([
      expect.objectContaining({ text: '예약 유지', style: 'cancel' }),
      expect.objectContaining({ text: '예약 취소', style: 'destructive' }),
    ]),
    { cancelable: false },
  );
  expect(screen.getByTestId('appointment-status-current')).toHaveTextContent(
    '예정',
  );

  const buttons = cancellationAlert.mock.calls[0]?.[2] ?? [];
  const keepAppointment = buttons.find(button => button.style === 'cancel');
  await act(async () => keepAppointment?.onPress?.());
  expect(screen.getByTestId('appointment-status-current')).toHaveTextContent(
    '예정',
  );

  const confirmCancellation = buttons.find(
    button => button.style === 'destructive',
  );
  await act(async () => confirmCancellation?.onPress?.());

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

test('uses the saved linked title and fallback without outlines, preserving selection and next-visit semantics', async () => {
  const linked = {
    ...appointment('linked', now + 60_000),
    clinicLabel: undefined,
    calendarEventIdentifier: 'synthetic-event',
    calendarEventSnapshot: {
      title: '  합성 정기 진료  ',
      timeZoneIdentifier: 'UTC',
      isAllDay: false,
      occurrenceDate: null,
      isDetached: false,
      recurrenceRules: [],
    },
  };
  const store = createAppointmentStore([
    linked,
    {
      ...appointment('untitled', now + 120_000),
      clinicLabel: undefined,
      calendarEventIdentifier: 'untitled-event',
      calendarEventSnapshot: { ...linked.calendarEventSnapshot, title: '  ' },
    },
    { ...appointment('local', now + 180_000), clinicLabel: '합성 직접 입력' },
  ]);
  await render(<AppointmentsScreen repository={store.repository} />);
  const named = await screen.findByTestId('appointment-select-linked');
  const unnamed = screen.getByTestId('appointment-select-untitled');
  const local = screen.getByTestId('appointment-select-local');
  expect(named).toHaveTextContent(/합성 정기 진료/u);
  expect(named.props.accessibilityLabel).toMatch(
    /^합성 정기 진료,.*다음 진료/u,
  );
  expect(screen.getByTestId('appointment-next-visit-linked')).toBeVisible();
  expect(screen.getByTestId('appointment-clinic-linked')).toHaveTextContent(
    '합성 정기 진료',
  );
  expect(unnamed).toHaveTextContent(/예약/u);
  expect(unnamed.props.accessibilityLabel).toMatch(/^예약,/u);
  expect(local).toHaveTextContent(/합성 직접 입력/u);
  for (const item of [named, unnamed, local])
    expect(StyleSheet.flatten(item.props.style).borderWidth ?? 0).toBe(0);
  expect(StyleSheet.flatten(named.props.style).backgroundColor).toBe(
    appColors.primarySoft,
  );
  await fireEvent.press(unnamed);
  expect(unnamed.props.accessibilityState).toEqual({ selected: true });
  expect(StyleSheet.flatten(unnamed.props.style).backgroundColor).toBe(
    appColors.primarySoft,
  );
  expect(screen.getByTestId('appointment-clinic-untitled')).toHaveTextContent(
    '예약',
  );
  expect(screen.getByTestId('appointment-next-visit-linked')).toBeVisible();
});
