import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { Dimensions, StyleSheet } from 'react-native';
import type { Appointment } from '@orot/storage';
import AppointmentCard from '../AppointmentCard';
import AppointmentsScreen from '../AppointmentsScreen';
import { createAppointmentStore } from '../../../test-helpers/appointmentStore';
import { appColors } from '../../layout/appColors';
import {
  AppointmentReminderProvider,
  createAppointmentReminderRuntime,
} from '../../appointmentReminders/AppointmentReminderContext';

const now = Date.parse('2026-10-20T12:00:00Z');

function appointment(id: string): Appointment {
  return {
    id,
    effectiveAt: new Date(now + 60_000).toISOString(),
    recordedAt: new Date(now).toISOString(),
    ingestedAt: new Date(now).toISOString(),
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    status: 'scheduled',
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

test('pairs reminders and separates the destructive action while keeping edit in the header', async () => {
  const store = createAppointmentStore([appointment('current')]);
  const minActionWidth = 92 * Math.max(1, Dimensions.get('window').fontScale);
  const runtime = createAppointmentReminderRuntime(
    async () => store.repository,
  );
  await render(
    <AppointmentReminderProvider runtime={runtime}>
      <AppointmentsScreen repository={store.repository} />
    </AppointmentReminderProvider>,
  );

  // Component styles prove the hierarchy; the native XCTest covers measured hit targets.
  const edit = await screen.findByTestId('appointment-edit-current');
  expect(edit.props.accessibilityRole).toBe('button');
  expect(StyleSheet.flatten(edit.props.style)).toMatchObject({
    backgroundColor: appColors.surface,
    borderRadius: 12,
    borderWidth: 0,
    minHeight: 44,
    minWidth: 44,
  });

  const header = screen.getByTestId('appointment-header-current');
  expect(within(header).getByTestId('appointment-edit-current')).toBe(edit);

  const actionRow = screen.getByTestId('appointment-reminder-actions');
  expect(StyleSheet.flatten(actionRow.props.style)).toMatchObject({
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  });
  await fireEvent(actionRow, 'layout', {
    nativeEvent: {
      layout: { width: minActionWidth * 3 + 16, height: 44, x: 0, y: 0 },
    },
  });
  const actions = within(actionRow);
  const oneHourReminder = actions.getByTestId(
    'appointment-reminder-current-60',
  );
  const oneDayReminder = actions.getByTestId(
    'appointment-reminder-current-1440',
  );
  expect(actions.queryByTestId('appointment-cancel-current')).toBeNull();
  const detailActions = screen.getByTestId('appointment-actions-current');
  const cancel = within(detailActions).getByTestId(
    'appointment-cancel-current',
  );
  expect(oneHourReminder.props.accessibilityLabel).toBe('1시간 전 알림');
  expect(oneDayReminder.props.accessibilityLabel).toBe('하루 전 알림');
  expect(within(oneHourReminder).getByText('1시간\n전 알림')).toBeTruthy();
  expect(within(oneDayReminder).getByText('하루\n전 알림')).toBeTruthy();
  for (const reminder of [oneHourReminder, oneDayReminder]) {
    expect(reminder.props.accessibilityState).toMatchObject({
      selected: false,
      disabled: false,
    });
    expect(StyleSheet.flatten(reminder.props.style)).toMatchObject({
      minHeight: 44,
      minWidth: 44,
    });
    expect(StyleSheet.flatten(reminder.parent?.props.style)).toMatchObject({
      flexBasis: 0,
      flexGrow: 1,
      flexShrink: 0,
      minWidth: minActionWidth,
    });
  }
  expect(cancel.props.accessibilityRole).toBe('button');
  expect(cancel.props.accessibilityLabel).toBe('current 예약 취소');
  const cancelLabel = within(cancel).getByText('예약 취소');
  expect(StyleSheet.flatten(cancel.props.style)).toMatchObject({
    backgroundColor: appColors.dangerSurface,
    borderColor: appColors.danger,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: 12,
  });
  expect(StyleSheet.flatten(detailActions.props.style)).toMatchObject({
    alignSelf: 'flex-start',
    maxWidth: '100%',
  });
  expect(StyleSheet.flatten(cancelLabel.props.style)).toMatchObject({
    color: appColors.danger,
    fontSize: 16,
    fontWeight: '600',
  });
  expect(actions.queryByTestId('appointment-edit-current')).toBeNull();
});

test.each([
  [2.7, 362, 'column'],
  [1, 280, 'column'],
  [1, 362, 'row'],
] as const)(
  'keeps the full clinic title and Edit reachable at scale %s and width %s',
  async (fontScale, width, flexDirection) => {
    const currentWindow = Dimensions.get('window');
    jest.spyOn(Dimensions, 'get').mockReturnValue({
      ...currentWindow,
      fontScale,
    });
    const clinicLabel = 'Synthetic teaching clinic and follow-up service';
    const onEdit = jest.fn();
    await render(
      <AppointmentCard
        appointment={{ ...appointment('layout'), clinicLabel }}
        onEdit={onEdit}
        onCancel={jest.fn()}
      />,
    );
    const header = screen.getByTestId('appointment-header-layout');
    await fireEvent(header, 'layout', {
      nativeEvent: { layout: { width, height: 44, x: 0, y: 0 } },
    });
    expect(StyleSheet.flatten(header.props.style).flexDirection).toBe(
      flexDirection,
    );
    const clinic = within(header).getByText(clinicLabel);
    expect(clinic.props.numberOfLines).toBeUndefined();
    if (flexDirection === 'column') {
      expect(StyleSheet.flatten(clinic.props.style)).toMatchObject({
        alignSelf: 'stretch',
      });
      expect(StyleSheet.flatten(clinic.props.style).flex).toBeUndefined();
    }
    const edit = within(header).getByRole('button');
    expect(StyleSheet.flatten(edit.props.style)).toMatchObject({
      minHeight: 44,
      minWidth: 44,
    });
    await fireEvent.press(edit);
    expect(onEdit).toHaveBeenCalledTimes(1);
  },
);
