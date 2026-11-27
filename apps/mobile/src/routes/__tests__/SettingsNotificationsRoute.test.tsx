import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Alert, Linking, NativeModules } from 'react-native';
import { dailyReminderNative } from '../../dailyReminders/nativeDailyReminder';
import { t } from '../../i18n';
import { SettingsNotificationsRoute } from '../SettingsNotificationsRoute';

jest.mock('../../dailyReminders/nativeDailyReminder', () => ({
  dailyReminderNative: jest.fn(),
}));
jest.mock('@react-native-community/datetimepicker', () => () => null);

afterEach(() => jest.restoreAllMocks());

test('keeps separate accessible help beside the actual notification controls without changing them', async () => {
  const nativeReminder = {
    read: jest.fn().mockResolvedValue(null),
    reconcile: jest
      .fn()
      .mockResolvedValue({ status: 'disabled', requestIdentifiers: [] }),
    save: jest.fn(),
  };
  jest.mocked(dailyReminderNative).mockReturnValue(nativeReminder);
  const nativeReply = {
    read: jest.fn().mockResolvedValue({ enabled: false, preview: true }),
    authorized: jest.fn().mockResolvedValue(true),
    save: jest.fn(),
  };
  NativeModules.ReplyNotificationModule = nativeReply;
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const systemSettings = jest
    .spyOn(Linking, 'openSettings')
    .mockResolvedValue(undefined);

  await render(<SettingsNotificationsRoute />);
  expect(screen.getByTestId('settings-notifications-scroll')).toBeTruthy();
  expect(screen.getByTestId('settings-notifications-title')).toHaveTextContent(
    t('settings.notifications'),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('switch', { name: t('settings.dailyReminder.enabled') }),
    ).not.toBeDisabled(),
  );

  const daily = {
    title: t('settings.dailyReminder.title'),
    message: t('settings.dailyReminder.description'),
  };
  const reply = {
    title: t('settings.replyNotification.title'),
    message: t('settings.replyNotification.description'),
  };
  for (const details of [daily, reply]) {
    expect(screen.queryByText(details.message)).toBeNull();
    await fireEvent.press(
      screen.getByRole('button', {
        name: t('settings.informationFor', { title: details.title }),
      }),
    );
    expect(alert).toHaveBeenLastCalledWith(details.title, details.message);
  }
  expect(alert).toHaveBeenCalledTimes(2);
  expect(systemSettings).not.toHaveBeenCalled();
  expect(nativeReminder.save).not.toHaveBeenCalled();
  expect(nativeReply.save).not.toHaveBeenCalled();
  expect(nativeReply.authorized).not.toHaveBeenCalled();
  expect(screen.getByTestId('settings-daily-reminder-time')).toBeEnabled();
  expect(
    screen.getByRole('switch', {
      name: t('settings.replyNotification.enabled'),
    }),
  ).toBeEnabled();
  expect(
    screen.getByRole('switch', {
      name: t('settings.replyNotification.preview'),
    }),
  ).toBeDisabled();
});
