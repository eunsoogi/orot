import { act, renderHook } from '@testing-library/react-native';
import type { Appointment } from '@orot/storage';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { useAppHomeData } from '../useAppHomeData';
import { savedSource } from '../../recording/recordingScreenSupport';

const origin = Date.parse('2026-10-20T12:00:00+09:00');
const appointment: Appointment = {
  id: 'ongoing',
  effectiveAt: new Date(origin - 60_000).toISOString(),
  endsAt: new Date(origin + 45_000).toISOString(),
  status: 'scheduled',
  recordedAt: new Date(origin).toISOString(),
  ingestedAt: new Date(origin).toISOString(),
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(origin);
});

afterEach(() => jest.useRealTimers());

async function setup() {
  const store = createAppointmentStore([]);
  const loadAppointments = async () => store.repository;
  const loadRecordings = async () => [];
  const hook = await renderHook(() =>
    useAppHomeData(loadAppointments, loadRecordings),
  );
  await act(async () => {});
  return { ...hook, store };
}

test('expires at the actual end when appointments refresh between minute ticks', async () => {
  const { result, store } = await setup();
  await act(async () => jest.advanceTimersByTime(30_000));
  store.repository.list.mockResolvedValue([appointment]);
  await act(async () => result.current.refreshAppointments());
  expect(result.current.nextAppointment?.id).toBe('ongoing');
  await act(async () => jest.advanceTimersByTime(10_000));
  // A second refresh must not restart the full delay from the previous clock snapshot.
  await act(async () => result.current.refreshAppointments());
  await act(async () => jest.advanceTimersByTime(4_999));
  expect(result.current.nextAppointment?.id).toBe('ongoing');
  await act(async () => jest.advanceTimersByTime(1));
  expect(result.current.nextAppointment).toBeNull();
});

test('never shows an already-ended appointment received between clock ticks', async () => {
  const { result, store } = await setup();
  await act(async () => jest.advanceTimersByTime(30_000));
  store.repository.list.mockResolvedValue([
    { ...appointment, endsAt: new Date(origin + 20_000).toISOString() },
  ]);
  await act(async () => result.current.refreshAppointments());
  expect(result.current.nextAppointment).toBeNull();
});

test('reads actual newly saved sources and visits after returning to the Home tab', async () => {
  const store = createAppointmentStore([]);
  const loadAppointments = async () => store.repository;
  const loadRecordings = jest
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValue([savedSource]);
  const { result, rerender } = await renderHook(
    ({ active }: { active: boolean }) =>
      useAppHomeData(loadAppointments, loadRecordings, active),
    { initialProps: { active: true } },
  );
  await act(async () => {});
  expect(result.current.recordings).toEqual([]);
  await rerender({ active: false });
  store.repository.list.mockResolvedValue([appointment]);
  await rerender({ active: true });
  await act(async () => {});
  expect(result.current.recordings).toEqual([savedSource]);
  expect(result.current.nextAppointment?.id).toBe(appointment.id);
});

test('a late older recording refresh cannot replace the latest snapshot', async () => {
  const store = createAppointmentStore([]);
  const loadAppointments = async () => store.repository;
  let finish!: (value: []) => void;
  const pending = new Promise<[]>(resolve => {
    finish = resolve;
  });
  const loadRecordings = jest
    .fn()
    .mockReturnValueOnce(pending)
    .mockResolvedValue([savedSource]);
  const { result } = await renderHook(() =>
    useAppHomeData(loadAppointments, loadRecordings),
  );
  await act(async () => result.current.refreshRecordings());
  await act(async () => {
    finish([]);
  });
  expect(result.current.recordings).toEqual([savedSource]);
  expect(result.current.recordingState).toBe('ready');
});
