import { fireEvent, render, screen } from '@testing-library/react-native';
import type { AppointmentRepository } from '@orot/storage';
import App from '../App';
import type { CalendarBridge } from '../src/calendar/types';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

function createCalendarBridge(): CalendarBridge {
  return {
    requestAccessAndListUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [],
    })),
    findEvent: jest.fn(async () => ({ access: 'fullAccess' as const, event: null })),
    addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
  };
}

test('opens on Calendar linking and waits for a user action before requesting access', async () => {
  const store = createAppointmentStore();
  const bridge = createCalendarBridge();
  await render(
    <App
      loadAppointments={async () => store.repository}
      calendarBridge={bridge}
    />,
  );

  expect(screen.getByRole('header', { name: '캘린더 연결' })).toBeTruthy();
  expect(screen.getByTestId('calendar-connect')).toHaveTextContent(
    '캘린더 일정 불러오기',
  );
  expect(
    screen.getByText(/캘린더 전체 접근\(읽기 및 쓰기\)/u),
  ).toBeTruthy();
  expect(screen.queryByTestId('appointment-add')).toBeNull();
  expect(bridge.requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
});

test('keeps the consent-gated recording screen reachable from Calendar linking', async () => {
  const store = createAppointmentStore();
  await render(<App loadAppointments={async () => store.repository} />);

  await fireEvent.press(screen.getByTestId('open-recording'));
  expect(await screen.findByRole('header', { name: '상담 녹음' })).toBeTruthy();
  expect(screen.getByText(/녹음 전에/)).toBeTruthy();
  expect(screen.getByTestId('recording-start')).toBeDisabled();

  await fireEvent.press(screen.getByTestId('recording-back'));
  expect(screen.getByTestId('calendar-title')).toHaveTextContent('캘린더 연결');
});

test('keeps Calendar linking available when local appointment storage needs a retry', async () => {
  const store = createAppointmentStore();
  const loadAppointments = jest
    .fn<Promise<AppointmentRepository>, []>()
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockResolvedValueOnce(store.repository);
  const bridge = createCalendarBridge();
  await render(<App loadAppointments={loadAppointments} calendarBridge={bridge} />);

  expect(await screen.findByTestId('calendar-app-opening')).toHaveTextContent(
    '예약을 열지 못했어요. 다시 시도해 주세요.',
  );
  await fireEvent.press(screen.getByTestId('calendar-app-retry'));

  expect(await screen.findByTestId('calendar-connect')).toBeTruthy();
  expect(bridge.requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
});
