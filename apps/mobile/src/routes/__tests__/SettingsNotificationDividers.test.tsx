import { render, screen, within } from '@testing-library/react-native';
import { NativeModules, StyleSheet } from 'react-native';
import { t } from '../../i18n';
import { SettingsDailyReminderSection } from '../SettingsDailyReminderSection';
import { SettingsReplyNotificationSection } from '../SettingsReplyNotificationSection';

jest.mock('../../dailyReminders/nativeDailyReminder', () => ({
  dailyReminderNative: () => ({
    read: async () => null,
    reconcile: async () => ({ status: 'disabled', requestIdentifiers: [] }),
    save: jest.fn(),
  }),
}));
jest.mock('@react-native-community/datetimepicker', () => () => null);

test.each(['daily', 'reply'])(
  'uses noninteractive horizontal rules in %s notification settings',
  async kind => {
    NativeModules.ReplyNotificationModule = {
      read: jest.fn().mockResolvedValue({ enabled: false, preview: false }),
      authorized: jest.fn().mockResolvedValue(true),
      save: jest.fn(),
    };
    await render(
      kind === 'daily' ? (
        <SettingsDailyReminderSection />
      ) : (
        <SettingsReplyNotificationSection />
      ),
    );
    expect(
      screen.queryByText(
        t(
          kind === 'daily'
            ? 'settings.dailyReminder.description'
            : 'settings.replyNotification.description',
        ),
      ),
    ).toBeNull();
    const rules = screen.getAllByTestId('settings-notification-divider', {
      includeHiddenElements: true,
    });
    expect(rules).toHaveLength(1);
    for (const rule of rules) {
      expect(rule).toHaveStyle({
        height: StyleSheet.hairlineWidth,
        alignSelf: 'stretch',
        marginHorizontal: 16,
      });
      expect(rule.props.pointerEvents).toBe('none');
      expect(rule.props.accessible).toBe(false);
      expect(rule.props.importantForAccessibility).toBe('no');
    }
    expect(screen.getAllByRole('switch')).toHaveLength(
      kind === 'daily' ? 1 : 2,
    );
    expect(NativeModules.ReplyNotificationModule.save).not.toHaveBeenCalled();
  },
);

test('centers every switch on its own wrapping label, with the preview warning in a separate footer', async () => {
  NativeModules.ReplyNotificationModule = {
    read: jest.fn().mockResolvedValue({ enabled: true, preview: false }),
    authorized: jest.fn().mockResolvedValue(true),
    save: jest.fn(),
  };
  await render(
    <>
      <SettingsDailyReminderSection />
      <SettingsReplyNotificationSection />
    </>,
  );
  const warning = t('settings.replyNotification.previewRisk');
  expect(screen.getByText(warning)).toBeVisible();
  expect(screen.queryByText(t('settings.dailyReminder.disabled'))).toBeNull();
  for (const id of [
    'settings-daily-reminder',
    'settings-reply-notification',
    'settings-reply-preview',
  ]) {
    const row = screen.getByTestId(`${id}-toggle-row`);
    expect(row).toHaveStyle({ alignItems: 'center', flexDirection: 'row' });
    expect(within(row).getByTestId(`${id}-toggle-label-target`)).toHaveStyle({
      flex: 1,
      minWidth: 0,
      justifyContent: 'center',
    });
    expect(
      within(row).getByTestId(`${id}-toggle-label`).props.numberOfLines,
    ).toBeUndefined();
    expect(within(row).getByRole('switch')).toHaveStyle({
      minHeight: 44,
      minWidth: 44,
      flexShrink: 0,
    });
    expect(within(row).queryByText(warning)).toBeNull();
  }
  expect(NativeModules.ReplyNotificationModule.save).not.toHaveBeenCalled();
});
