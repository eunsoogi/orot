import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Appointment, AppointmentRepository } from '@orot/storage';
import App from '../App';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

// Unit tests have no native window; Detox covers real device insets and hit targets.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

test('shows the initial welcome state', async () => {
  await render(<App />);

  expect(
    screen.getByRole('header', { name: 'Orot에 오신 걸 환영해요' }),
  ).toBeTruthy();
  expect(screen.getByText('Orot의 첫걸음이에요.')).toBeTruthy();
  expect(screen.getByRole('button', { name: '시작하기' })).toBeTruthy();
});

test('updates the welcome message when the user gets started', async () => {
  await render(<App />);

  await fireEvent.press(screen.getByRole('button', { name: '시작하기' }));

  expect(screen.getByText('이제 시작할 수 있어요.')).toBeTruthy();
});

test('opens the provider selection flow from the welcome screen', async () => {
  await render(<App />);

  await fireEvent.press(screen.getByTestId('open-provider-selection'));

  expect(
    await screen.findByRole('header', { name: '추천에 사용할 AI 선택' }),
  ).toBeTruthy();
  expect(screen.getByTestId('chatgpt-account-setup')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('provider-selection-back'));
  expect(screen.getByTestId('welcome-title')).toBeTruthy();
});

test('opens consultation recording behind an explicit consent step', async () => {
  await render(<App />);

  await fireEvent.press(screen.getByTestId('open-recording'));

  expect(await screen.findByRole('header', { name: '상담 녹음' })).toBeTruthy();
  expect(screen.getByText(/녹음 전에/)).toBeTruthy();
  expect(screen.getByTestId('recording-start')).toBeDisabled();
});

test('falls back to Korean when opening appointments fails and can retry', async () => {
  const store = createAppointmentStore();
  const loadAppointments = jest
    .fn<Promise<AppointmentRepository>, []>()
    .mockRejectedValueOnce(new Error('storage unavailable'))
    .mockResolvedValueOnce(store.repository);
  await render(<App loadAppointments={loadAppointments} />);

  await fireEvent.press(screen.getByTestId('open-appointments'));
  expect(await screen.findByTestId('appointments-opening')).toHaveTextContent(
    '예약을 열지 못했어요. 다시 시도해 주세요.',
  );
  expect(screen.getByRole('button', { name: '다시 시도' })).toBeTruthy();

  await fireEvent.press(screen.getByTestId('appointments-retry-open'));
  expect(await screen.findByTestId('appointments-empty')).toHaveTextContent(
    '등록된 예약이 없어요.',
  );
});

test('shows Korean loading, error, and empty states for the appointment list', async () => {
  const store = createAppointmentStore();
  let resolveList!: (appointments: Appointment[]) => void;
  store.repository.list = jest.fn(
    () =>
      new Promise<Appointment[]>(resolve => {
        resolveList = resolve;
      }),
  );
  await render(<App loadAppointments={async () => store.repository} />);

  await fireEvent.press(screen.getByTestId('open-appointments'));
  expect(screen.getByTestId('appointments-loading')).toHaveTextContent(
    '예약을 불러오는 중…',
  );

  resolveList([]);
  expect(await screen.findByTestId('appointments-empty')).toHaveTextContent(
    '등록된 예약이 없어요.',
  );
});

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
  ).toHaveTextContent('예정');
  expect(await screen.findByText('예약을 저장했어요.')).toBeTruthy();
  expect(store.getAppointments()[0]?.status).toBe('scheduled');
  expect(screen.getByTestId('appointment-time-manual-1')).toHaveTextContent(
    '2027년 6월 2일 09:45 · 현지 시간',
  );

  await fireEvent.press(screen.getByTestId('appointment-edit-manual-1'));
  expect(screen.getByRole('header', { name: '예약 수정' })).toBeTruthy();
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
    '일정 변경',
  );
  expect(await screen.findByText('예약을 수정했어요.')).toBeTruthy();
  expect(store.getAppointments()[0]?.status).toBe('rescheduled');

  await fireEvent.press(screen.getByTestId('appointment-cancel-manual-1'));
  expect(
    await screen.findByTestId('appointment-status-manual-1'),
  ).toHaveTextContent('취소됨');
  expect(await screen.findByText('예약을 취소했어요.')).toBeTruthy();
  expect(store.getAppointments()[0]?.status).toBe('cancelled');
  expect(screen.queryByTestId('appointment-cancel-manual-1')).toBeNull();
});

test('shows the completed status in Korean without exposing edit actions', async () => {
  const completed: Appointment = {
    id: 'completed-1',
    effectiveAt: '2027-06-02T00:45:00.000Z',
    recordedAt: '2027-06-01T00:00:00.000Z',
    ingestedAt: '2027-06-01T00:00:00.000Z',
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    status: 'completed',
    clinicLabel: 'Completed visit',
  };
  const store = createAppointmentStore([completed]);
  await render(<App loadAppointments={async () => store.repository} />);

  await fireEvent.press(screen.getByTestId('open-appointments'));
  expect(
    await screen.findByTestId('appointment-status-completed-1'),
  ).toHaveTextContent('완료');
  expect(screen.queryByTestId('appointment-edit-completed-1')).toBeNull();
  expect(screen.queryByTestId('appointment-cancel-completed-1')).toBeNull();
  expect(store.getAppointments()[0]?.status).toBe('completed');
});
