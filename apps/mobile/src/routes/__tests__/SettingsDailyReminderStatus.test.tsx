import { AppState, Linking, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { DailyReminderNativeModule } from '../../dailyReminders/nativeDailyReminder';
import { dailyReminderNative } from '../../dailyReminders/nativeDailyReminder';
import { appColors } from '../../layout/appColors';
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

test('shows a saved local time and current denied permission state after reopening Settings', async () => {
  native.read.mockResolvedValue({ enabled: true, hour: 9, minute: 5 });
  native.reconcile.mockResolvedValue({
    status: 'denied',
    authorization: 'denied',
    requestIdentifiers: [],
  });
  const openSettings = jest
    .spyOn(Linking, 'openSettings')
    .mockResolvedValue(undefined);
  try {
    await render(<SettingsDailyReminderSection />);

    expect(
      await screen.findByText(t('settings.dailyReminder.denied')),
    ).toBeTruthy();
    expect(screen.getByText('09:05')).toBeTruthy();
    expect(
      screen.getByTestId('settings-daily-reminder-switch').props.value,
    ).toBe(true);
    expect(
      screen.queryByText(
        t('settings.dailyReminder.scheduled', { time: '09:05' }),
      ),
    ).toBeNull();
    await fireEvent.press(
      screen.getByTestId('settings-daily-reminder-recovery'),
    );
    expect(openSettings).toHaveBeenCalledTimes(1);
  } finally {
    openSettings.mockRestore();
  }
});

test('refreshes revoked notification access when the app returns to Settings', async () => {
  native.read.mockResolvedValue({ enabled: true, hour: 9, minute: 5 });
  native.reconcile.mockResolvedValue({
    status: 'scheduled',
    authorization: 'authorized',
    requestIdentifiers: ['com.orot.daily-report'],
  });
  const appState = jest.spyOn(AppState, 'addEventListener');
  try {
    await render(<SettingsDailyReminderSection />);
    expect(
      await screen.findByText(
        t('settings.dailyReminder.scheduled', { time: '09:05' }),
      ),
    ).toBeTruthy();

    native.reconcile.mockResolvedValue({
      status: 'denied',
      authorization: 'denied',
      requestIdentifiers: [],
    });
    const onChange = appState.mock.calls[0]?.[1];
    expect(onChange).toBeDefined();
    await act(async () => onChange?.('active'));

    expect(
      await screen.findByText(t('settings.dailyReminder.denied')),
    ).toBeTruthy();
    expect(native.save).not.toHaveBeenCalled();
  } finally {
    appState.mockRestore();
  }
});

test('keeps a scheduling failure visible and allows an explicit retry', async () => {
  native.read.mockResolvedValue({ enabled: true, hour: 8, minute: 0 });
  native.reconcile.mockResolvedValue({
    status: 'scheduled',
    authorization: 'authorized',
    requestIdentifiers: ['com.orot.daily-report'],
  });
  native.save
    .mockResolvedValueOnce({ status: 'error', requestIdentifiers: [] })
    .mockResolvedValueOnce({
      status: 'scheduled',
      authorization: 'authorized',
      requestIdentifiers: ['com.orot.daily-report'],
    });
  await render(<SettingsDailyReminderSection />);
  await fireEvent.press(
    await screen.findByTestId('settings-daily-reminder-time'),
  );
  await fireEvent.press(screen.getByTestId('mock-daily-reminder-time-change'));
  await fireEvent.press(
    screen.getByTestId('settings-daily-reminder-save-time'),
  );

  expect(
    await screen.findByText(t('settings.dailyReminder.scheduleError')),
  ).toBeTruthy();
  expect(
    screen.queryByText(
      t('settings.dailyReminder.scheduled', { time: '20:15' }),
    ),
  ).toBeNull();
  await fireEvent.press(screen.getByTestId('settings-daily-reminder-recovery'));
  expect(
    await screen.findByText(
      t('settings.dailyReminder.scheduled', { time: '20:15' }),
    ),
  ).toBeTruthy();
  expect(native.save).toHaveBeenCalledTimes(2);
});

test('uses accessible controls and shared appearance colors', async () => {
  await render(<SettingsDailyReminderSection />);
  const toggle = await screen.findByTestId('settings-daily-reminder-switch');
  const card = StyleSheet.flatten(
    screen.getByTestId('settings-daily-reminder-card').props.style,
  );

  expect(toggle.props.accessibilityRole).toBe('switch');
  expect(toggle.props.accessibilityLabel).toBe(
    t('settings.dailyReminder.enabled'),
  );
  expect(card?.backgroundColor).toBe(appColors.surface);
});
