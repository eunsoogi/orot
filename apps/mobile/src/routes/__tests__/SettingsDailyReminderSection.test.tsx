import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import {
  dailyReminderPickerDate,
  formatDailyReminderTime,
} from '../../dailyReminders/dailyReminderPresentation';
import type { DailyReminderNativeModule } from '../../dailyReminders/nativeDailyReminder';
import { dailyReminderNative } from '../../dailyReminders/nativeDailyReminder';
import { t } from '../../i18n';
import { SettingsDailyReminderSection } from '../SettingsDailyReminderSection';

jest.mock('../../dailyReminders/nativeDailyReminder', () => ({
  dailyReminderNative: jest.fn(),
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const React = jest.requireActual('react');
  const { Pressable, Text } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: ({
      onChange,
      value,
    }: {
      onChange: (event: { type: string }, value?: Date) => void;
      value: Date;
    }) =>
      React.createElement(
        Pressable,
        {
          onPress: () => {
            const selected = new Date(value);
            selected.setHours(20, 15, 0, 0);
            onChange({ type: 'set' }, selected);
          },
          testID: 'mock-daily-reminder-time-change',
        },
        React.createElement(Text, null, 'Choose time'),
      ),
  };
});

const native = {
  read: jest.fn(),
  reconcile: jest.fn(),
  save: jest.fn(),
};
const dailyReminderNativeMock = jest.mocked(dailyReminderNative);

beforeEach(() => {
  jest.clearAllMocks();
  native.read.mockResolvedValue(null);
  native.reconcile.mockResolvedValue({
    status: 'disabled',
    requestIdentifiers: [],
  });
  native.save.mockImplementation(async preference =>
    preference.enabled
      ? {
          status: 'scheduled',
          authorization: 'authorized',
          requestIdentifiers: ['com.orot.daily-report'],
        }
      : { status: 'disabled', requestIdentifiers: [] },
  );
  dailyReminderNativeMock.mockReturnValue(
    native as unknown as DailyReminderNativeModule,
  );
});

function expectReminderSwitchState(enabled: boolean) {
  const target = screen.getByTestId('settings-daily-reminder-switch');
  const visual = screen.getByTestId('settings-daily-reminder-switch-visual', {
    includeHiddenElements: true,
  });
  expect(target.props.accessibilityState.checked).toBe(enabled);
  expect(visual.props.value).toBe(enabled);
}

test('formats the saved wall-clock time in the app locale and keeps picker fields local', () => {
  expect(formatDailyReminderTime(9, 5)).toBe('09:05');

  const pickerDate = dailyReminderPickerDate({
    enabled: false,
    hour: 20,
    minute: 15,
  });
  expect([pickerDate.getHours(), pickerDate.getMinutes()]).toEqual([20, 15]);
});

test('starts from the saved opt-in state without asking for permission on entry', async () => {
  await render(<SettingsDailyReminderSection />);

  expect(
    await screen.findByText(t('settings.dailyReminder.disabled')),
  ).toBeTruthy();
  expect(native.read).toHaveBeenCalledTimes(1);
  expect(native.reconcile).toHaveBeenCalledTimes(1);
  expect(native.save).not.toHaveBeenCalled();
  expectReminderSwitchState(false);
  expect(
    screen.getByTestId('settings-daily-reminder-time').props.accessibilityRole,
  ).toBe('button');
});

test('keeps the native and accessible switch targets disabled while loading', async () => {
  native.read.mockImplementation(() => new Promise(() => {}));
  native.reconcile.mockImplementation(() => new Promise(() => {}));
  await render(<SettingsDailyReminderSection />);

  const toggle = screen.getByTestId('settings-daily-reminder-switch');
  const visualSwitch = screen.getByTestId(
    'settings-daily-reminder-switch-visual',
    { includeHiddenElements: true },
  );

  expect(toggle.props.accessibilityState.disabled).toBe(true);
  expect(visualSwitch.props.disabled).toBe(true);
  await fireEvent.press(toggle);
  expect(
    screen.queryByTestId('settings-daily-reminder-picker-sheet'),
  ).toBeNull();
  expect(native.save).not.toHaveBeenCalled();
});

test('sizes the switch target from its measured native frame', async () => {
  await render(<SettingsDailyReminderSection />);
  const toggle = screen.getByTestId('settings-daily-reminder-switch');
  const visualSwitch = screen.getByTestId(
    'settings-daily-reminder-switch-visual',
    { includeHiddenElements: true },
  );
  // Synthetic dimensions check the measured target arithmetic, not UIKit geometry.
  const measuredWidth = 31;
  const measuredHeight = 31;

  await fireEvent(visualSwitch, 'layout', {
    nativeEvent: {
      layout: { height: measuredHeight, width: measuredWidth, x: 0, y: 0 },
    },
  });

  const targetStyle = StyleSheet.flatten(toggle.props.style);
  expect(measuredWidth + 2 * targetStyle.paddingHorizontal).toBe(44);
  expect(measuredHeight + 2 * targetStyle.paddingVertical).toBe(44);
  expect(targetStyle).toMatchObject({
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  });
});

test('requires an explicit time confirmation before first enablement', async () => {
  await render(<SettingsDailyReminderSection />);
  const toggle = await screen.findByTestId('settings-daily-reminder-switch');

  await fireEvent.press(toggle);
  expect(
    screen.getByTestId('settings-daily-reminder-picker-sheet'),
  ).toBeTruthy();
  expect(native.save).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('mock-daily-reminder-time-change'));
  await fireEvent.press(
    screen.getByTestId('settings-daily-reminder-save-time'),
  );

  await waitFor(() =>
    expect(native.save).toHaveBeenCalledWith({
      enabled: true,
      hour: 20,
      minute: 15,
    }),
  );
  expect(native.save).toHaveBeenCalledTimes(1);
  expect(
    await screen.findByText(
      t('settings.dailyReminder.scheduled', { time: '20:15' }),
    ),
  ).toBeTruthy();
});

test('canceling the time picker leaves the saved setting unchanged', async () => {
  await render(<SettingsDailyReminderSection />);
  const timeButton = await screen.findByTestId('settings-daily-reminder-time');
  await fireEvent.press(timeButton);
  await fireEvent.press(screen.getByTestId('mock-daily-reminder-time-change'));
  await fireEvent.press(screen.getByTestId('settings-daily-reminder-cancel'));

  expect(native.save).not.toHaveBeenCalled();
  expectReminderSwitchState(false);
  expect(screen.getByText(t('settings.dailyReminder.disabled'))).toBeTruthy();
});

test('disabling a saved reminder preserves its time in the native preference', async () => {
  native.read.mockResolvedValue({ enabled: true, hour: 6, minute: 40 });
  native.reconcile.mockResolvedValue({
    status: 'scheduled',
    authorization: 'authorized',
    requestIdentifiers: ['com.orot.daily-report'],
  });
  await render(<SettingsDailyReminderSection />);
  const toggle = await screen.findByTestId('settings-daily-reminder-switch');

  await fireEvent.press(toggle);

  await waitFor(() =>
    expect(native.save).toHaveBeenCalledWith({
      enabled: false,
      hour: 6,
      minute: 40,
    }),
  );
  expect(
    await screen.findByText(t('settings.dailyReminder.disabled')),
  ).toBeTruthy();
  expect(native.save).toHaveBeenCalledTimes(1);
  expectReminderSwitchState(false);
});

test('changing the time while reminders are off keeps them disabled', async () => {
  native.read.mockResolvedValue({ enabled: false, hour: 8, minute: 30 });
  await render(<SettingsDailyReminderSection />);

  await fireEvent.press(
    await screen.findByTestId('settings-daily-reminder-time'),
  );
  await fireEvent.press(screen.getByTestId('mock-daily-reminder-time-change'));
  await fireEvent.press(
    screen.getByTestId('settings-daily-reminder-save-time'),
  );

  await waitFor(() =>
    expect(native.save).toHaveBeenCalledWith({
      enabled: false,
      hour: 20,
      minute: 15,
    }),
  );
  expect(
    await screen.findByText(t('settings.dailyReminder.disabled')),
  ).toBeTruthy();
});
