import { AppState } from 'react-native';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import type { Appointment } from '@orot/storage';
import AppointmentsScreen from '../AppointmentsScreen';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { notifyLocalDataCleared } from '../../storage/localDataClearEvents';

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

test('keeps the selected list row during refresh and offers retry on failure', async () => {
  const visit = appointment('retained', now + 60_000);
  const store = createAppointmentStore([visit]);
  let fail!: (error: Error) => void;
  const pending = new Promise<Appointment[]>((_, reject) => {
    fail = reject;
  });
  store.list.mockResolvedValueOnce([visit]).mockReturnValueOnce(pending);
  const rendered = await render(
    <AppointmentsScreen active repository={store.repository} />,
  );
  await screen.findByTestId('appointment-select-retained');
  await rendered.rerender(
    <AppointmentsScreen active={false} repository={store.repository} />,
  );
  await rendered.rerender(
    <AppointmentsScreen active repository={store.repository} />,
  );
  expect(screen.getByTestId('appointments-loading')).toBeTruthy();
  expect(
    screen.getByTestId('appointment-select-retained').props.accessibilityState
      .selected,
  ).toBe(true);
  await act(async () => fail(new Error('temporary read failure')));
  expect(screen.getByTestId('appointment-select-retained')).toBeTruthy();
  expect(screen.queryByTestId('appointments-empty')).toBeNull();
  await fireEvent.press(screen.getByTestId('appointments-retry'));
  expect(store.list).toHaveBeenCalledTimes(3);
});

test('ignores a pending list after a local data clear', async () => {
  const visit = appointment('deleted', now + 60_000);
  const store = createAppointmentStore([visit]);
  let resolveOld!: (rows: Appointment[]) => void;
  const pending = new Promise<Appointment[]>(resolve => {
    resolveOld = resolve;
  });
  store.list
    .mockResolvedValueOnce([visit])
    .mockReturnValueOnce(pending)
    .mockResolvedValueOnce([]);
  const route = await render(
    <AppointmentsScreen active repository={store.repository} />,
  );
  await screen.findByTestId('appointment-select-deleted');
  await route.rerender(
    <AppointmentsScreen active={false} repository={store.repository} />,
  );
  await route.rerender(
    <AppointmentsScreen active repository={store.repository} />,
  );
  expect(screen.getByTestId('appointments-loading')).toBeTruthy();
  await act(async () => notifyLocalDataCleared());
  await screen.findByTestId('appointments-empty');
  await act(async () => resolveOld([visit]));
  expect(screen.queryByTestId('appointment-select-deleted')).toBeNull();
  expect(screen.getByTestId('appointments-empty')).toBeTruthy();
});

test('keeps a manual history choice on re-entry and defaults after its removal', async () => {
  let appointments = [
    appointment('history', now - 60_000, 'cancelled'),
    appointment('next', now + 60_000),
    appointment('later', now + 2 * 60_000),
  ];
  const store = createAppointmentStore(appointments);
  store.list.mockImplementation(async () => [...appointments]);
  const rendered = await render(
    <AppointmentsScreen active={false} repository={store.repository} />,
  );
  expect(store.repository.list).not.toHaveBeenCalled();

  await rendered.rerender(
    <AppointmentsScreen active repository={store.repository} />,
  );
  const history = await screen.findByTestId('appointment-select-history');
  await fireEvent.press(history);
  expect(history.props.accessibilityState.selected).toBe(true);
  expect(screen.getByTestId('appointment-next-visit-next')).toBeTruthy();

  await rendered.rerender(
    <AppointmentsScreen active={false} repository={store.repository} />,
  );
  await rendered.rerender(
    <AppointmentsScreen active repository={store.repository} />,
  );
  await waitFor(() => expect(store.repository.list).toHaveBeenCalledTimes(2));
  expect(
    screen.getByTestId('appointment-select-history').props.accessibilityState
      .selected,
  ).toBe(true);

  appointments = appointments.filter(item => item.id !== 'history');
  await rendered.rerender(
    <AppointmentsScreen active={false} repository={store.repository} />,
  );
  await rendered.rerender(
    <AppointmentsScreen active repository={store.repository} />,
  );
  await waitFor(() => expect(store.repository.list).toHaveBeenCalledTimes(3));
  expect(screen.queryByTestId('appointment-select-history')).toBeNull();
  expect(
    screen.getByTestId('appointment-select-next').props.accessibilityState
      .selected,
  ).toBe(true);
});

test('declaring the app active preserves the selected visit without reloading', async () => {
  const visit = appointment('retained', now + 60_000);
  const store = createAppointmentStore([visit]);
  const listeners = new Set<Parameters<typeof AppState.addEventListener>[1]>();
  const subscription = jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((event, handler) => {
      if (event === 'change') listeners.add(handler);
      return {
        remove: () => {
          listeners.delete(handler);
        },
      };
    });

  try {
    await render(<AppointmentsScreen repository={store.repository} />);
    const selected = () =>
      screen.getByTestId('appointment-select-retained').props.accessibilityState
        .selected;
    expect(selected()).toBe(true);
    await act(async () => {
      for (const state of ['inactive', 'background', 'active'] as const)
        for (const listener of [...listeners]) listener(state);
    });
    expect(store.repository.list).toHaveBeenCalledTimes(1);
    expect(selected()).toBe(true);
  } finally {
    subscription.mockRestore();
  }
});
