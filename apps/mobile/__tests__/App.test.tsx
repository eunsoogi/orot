import { fireEvent, render, screen } from '@testing-library/react-native';
import type { AppointmentRepository } from '@orot/storage';
import App from '../App';
import type { CalendarBridge } from '../src/calendar/types';
import { importLocalCommonObservations } from '../src/healthkit/commonObservations/importLocal';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

jest.mock('../src/healthkit/commonObservations/importLocal', () => ({
  importLocalCommonObservations: jest.fn(),
}));

function createCalendarBridge(): CalendarBridge {
  return {
    requestAccessAndListUpcomingEvents: jest.fn(async () => ({
      access: 'fullAccess' as const,
      events: [],
    })),
    findEvent: jest.fn(async () => ({
      access: 'fullAccess' as const,
      event: null,
    })),
    addEventStoreListener: jest.fn(() => ({ remove: jest.fn() })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('restores the welcome entry and opens Calendar linking from the appointments action', async () => {
  const store = createAppointmentStore();
  const bridge = createCalendarBridge();
  const loadAppointments = jest.fn(async () => store.repository);
  await render(
    <App loadAppointments={loadAppointments} calendarBridge={bridge} />,
  );

  expect(screen.getByTestId('welcome-title')).toHaveTextContent(
    'Orot에 오신 걸 환영해요',
  );
  expect(screen.getByTestId('get-started')).toHaveTextContent('시작하기');
  expect(screen.getByTestId('open-appointments')).toHaveTextContent('예약');
  expect(loadAppointments).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('get-started'));
  expect(screen.getByText('이제 시작할 수 있어요.')).toBeTruthy();

  await fireEvent.press(screen.getByTestId('open-appointments'));
  expect(screen.getByRole('header', { name: '캘린더 연결' })).toBeTruthy();
  expect(screen.getByTestId('calendar-connect')).toHaveTextContent(
    '캘린더 일정 불러오기',
  );
  expect(screen.getByText(/캘린더 전체 접근\(읽기 및 쓰기\)/u)).toBeTruthy();
  expect(screen.queryByTestId('appointment-add')).toBeNull();
  expect(bridge.requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
});

test('keeps the consent-gated recording screen reachable from Calendar linking', async () => {
  const store = createAppointmentStore();
  await render(<App loadAppointments={async () => store.repository} />);

  await fireEvent.press(screen.getByTestId('open-appointments'));
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
  await render(
    <App loadAppointments={loadAppointments} calendarBridge={bridge} />,
  );

  await fireEvent.press(screen.getByTestId('open-appointments'));
  expect(await screen.findByTestId('calendar-app-opening')).toHaveTextContent(
    '예약을 열지 못했어요. 다시 시도해 주세요.',
  );
  await fireEvent.press(screen.getByTestId('calendar-app-retry'));

  expect(await screen.findByTestId('calendar-connect')).toBeTruthy();
  expect(bridge.requestAccessAndListUpcomingEvents).not.toHaveBeenCalled();
});

test('requires selection and an explicit import before reading common HealthKit types', async () => {
  const importHealthObservations = jest.fn().mockResolvedValue({
    status: 'complete',
    importedCount: 1,
    deletedCount: 0,
    unsupportedCount: 0,
  });
  await render(<App importHealthObservations={importHealthObservations} />);

  await fireEvent.press(screen.getByTestId('open-common-observations'));
  expect(
    screen.getByRole('header', { name: '건강 기록 가져오기' }),
  ).toBeTruthy();
  expect(screen.getByTestId('common-observations-import')).toBeDisabled();
  expect(importHealthObservations).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('common-observations-toggle-steps'));
  expect(importHealthObservations).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('common-observations-import'));

  expect(importHealthObservations).toHaveBeenCalledWith(['steps']);
  expect(
    await screen.findByText(
      '선택한 기록의 변경을 가져왔어요. 1개 저장, 0개 삭제, 0개 미지원',
    ),
  ).toBeTruthy();
  await fireEvent.press(screen.getByTestId('common-observations-back'));
  expect(screen.getByTestId('welcome-title')).toBeTruthy();
});

test('calls the production importer only after explicit selection', async () => {
  jest.mocked(importLocalCommonObservations).mockResolvedValue({
    status: 'complete',
    readAuthorization: 'notObservable',
    importedCount: 1,
    deletedCount: 0,
    unsupportedCount: 0,
    cursorAdvanced: true,
    stepAggregation: null,
  });
  await render(<App />);

  await fireEvent.press(screen.getByTestId('open-common-observations'));
  await fireEvent.press(
    screen.getByTestId('common-observations-toggle-bodyMass'),
  );
  expect(importLocalCommonObservations).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('common-observations-import'));

  expect(await screen.findByText(/1개 저장/u)).toBeTruthy();
  expect(importLocalCommonObservations).toHaveBeenCalledWith(['bodyMass']);
});
