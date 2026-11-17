import { render, screen } from '@testing-library/react-native';
import { NativeModules, StyleSheet } from 'react-native';
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
      screen.getByTestId(
        kind === 'daily'
          ? 'settings-daily-reminder-description'
          : 'settings-reply-notification-description',
      ),
    ).toHaveStyle({ paddingBottom: 12, fontSize: 15 });
    const rules = screen.getAllByTestId('settings-notification-divider', {
      includeHiddenElements: true,
    });
    expect(rules).toHaveLength(2);
    for (const rule of rules) {
      expect(rule).toHaveStyle({
        height: StyleSheet.hairlineWidth,
        alignSelf: 'stretch',
        marginHorizontal: kind === 'daily' ? 16 : 0,
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
