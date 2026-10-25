import { StyleSheet } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { CalendarQuickActions } from '../CalendarQuickActions';

test('groups available appointment shortcuts into a compact, accessible row', async () => {
  const onOpenAppointments = jest.fn();
  const onOpenMedicalAppointments = jest.fn();
  await render(
    <CalendarQuickActions
      disabled={false}
      onOpenAppointments={onOpenAppointments}
      onOpenMedicalAppointments={onOpenMedicalAppointments}
    />,
  );

  const shortcuts = screen.getByTestId('calendar-quick-actions');
  expect(StyleSheet.flatten(shortcuts.props.style).flexDirection).toBe('row');
  const primarySchedule = within(shortcuts).getByTestId(
    'schedule-open-appointments',
  );
  const medicalSchedule = within(shortcuts).getByTestId(
    'open-medical-appointments',
  );
  expect(primarySchedule.props.accessibilityRole).toBe('button');
  expect(medicalSchedule.props.accessibilityRole).toBe('button');
  expect(primarySchedule.props.accessibilityLabel).toBe('예약 관리');
  expect(medicalSchedule.props.accessibilityLabel).toBe(
    'AI로 일정 분류, 필요할 때만 실행',
  );
  expect(within(shortcuts).getByText('필요할 때만 실행')).toBeTruthy();
  await fireEvent.press(primarySchedule);
  await fireEvent.press(medicalSchedule);
  expect(onOpenAppointments).toHaveBeenCalledTimes(1);
  expect(onOpenMedicalAppointments).toHaveBeenCalledTimes(1);
});

test('omits unavailable shortcuts and preserves the disabled state', async () => {
  await render(
    <CalendarQuickActions disabled onOpenAppointments={jest.fn()} />,
  );

  expect(screen.getByTestId('schedule-open-appointments')).toBeDisabled();
  expect(screen.queryByTestId('open-medical-appointments')).toBeNull();
});
