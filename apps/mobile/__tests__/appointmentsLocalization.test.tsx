import { fireEvent, render, screen } from '@testing-library/react-native';
import AppointmentsScreen from '../src/appointments/AppointmentsScreen';
import { createAppointmentStore } from '../test-helpers/appointmentStore';

test('opens editing without the list above the form and restores the list on cancel', async () => {
  const store = createAppointmentStore();
  await store.create({
    clinicLabel: 'Cardiology clinic',
    effectiveAt: '2027-06-02T09:45:00Z',
  });
  await render(<AppointmentsScreen repository={store.repository} />);
  await screen.findByTestId('appointment-status-manual-1');
  await fireEvent.press(screen.getByText('수정'));

  // A separate editing surface keeps existing cards from pushing inputs below the keyboard.
  expect(screen.queryByTestId('appointment-status-manual-1')).toBeNull();
  expect(screen.getByTestId('appointment-clinic-input')).toHaveDisplayValue(
    'Cardiology clinic',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-clinic-input'),
    'Draft',
  );
  await fireEvent.press(screen.getByTestId('appointment-form-cancel'));
  expect(await screen.findByText('Cardiology clinic')).toBeTruthy();
  expect(screen.queryByTestId('appointment-clinic-input')).toBeNull();
  expect(store.update).not.toHaveBeenCalled();
});

test('localizes appointment list errors and retry', async () => {
  const store = createAppointmentStore();
  store.list
    .mockRejectedValueOnce(new Error('database unavailable'))
    .mockResolvedValueOnce([]);
  await render(<AppointmentsScreen repository={store.repository} />);

  expect(await screen.findByTestId('appointment-error')).toHaveTextContent(
    '예약을 불러오지 못했어요. 다시 시도해 주세요.',
  );
  await fireEvent.press(screen.getByTestId('appointments-retry'));
  expect(await screen.findByTestId('appointments-empty')).toHaveTextContent(
    '등록된 예약이 없어요.',
  );
});

test('shows localized validation messages without storing invalid input', async () => {
  const store = createAppointmentStore();
  await render(<AppointmentsScreen repository={store.repository} />);

  await screen.findByTestId('appointments-empty');
  await fireEvent.press(screen.getByTestId('appointment-add'));
  await fireEvent.changeText(
    screen.getByTestId('appointment-date-input'),
    '2027-06-02',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-time-input'),
    '09:45',
  );
  await fireEvent.press(screen.getByTestId('appointment-save'));
  expect(screen.getByTestId('appointment-error')).toHaveTextContent(
    '병원 또는 진료과를 입력해 주세요.',
  );

  await fireEvent.changeText(
    screen.getByTestId('appointment-clinic-input'),
    'Clinic name',
  );
  await fireEvent.changeText(
    screen.getByTestId('appointment-date-input'),
    'not-a-date',
  );
  await fireEvent.press(screen.getByTestId('appointment-save'));
  expect(screen.getByTestId('appointment-error')).toHaveTextContent(
    '올바른 날짜와 시간을 입력해 주세요.',
  );
  expect(store.create).not.toHaveBeenCalled();
  expect(store.getAppointments()).toHaveLength(0);
});

test('localizes appointment save and cancel failures without changing status enums', async () => {
  const store = createAppointmentStore();
  store.create.mockRejectedValueOnce(new Error('write unavailable'));
  await render(<AppointmentsScreen repository={store.repository} />);

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
  await fireEvent.press(screen.getByTestId('appointment-save'));
  expect(await screen.findByTestId('appointment-error')).toHaveTextContent(
    '예약을 저장하지 못했어요. 다시 시도해 주세요.',
  );
  expect(store.getAppointments()).toHaveLength(0);

  await fireEvent.press(screen.getByTestId('appointment-save'));
  await screen.findByTestId('appointment-status-manual-1');
  store.cancel.mockRejectedValueOnce(new Error('write unavailable'));
  await fireEvent.press(screen.getByTestId('appointment-cancel-manual-1'));
  expect(await screen.findByTestId('appointment-error')).toHaveTextContent(
    '예약을 취소하지 못했어요. 다시 시도해 주세요.',
  );
  expect(store.getAppointments()[0]?.status).toBe('scheduled');
});
