import { NativeModules, StyleSheet } from 'react-native';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { appColors } from '../../layout/appColors';
import { t } from '../../i18n';
import { SettingsRoute } from '../SettingsRoute';
import { settingsRouteResolverOptions } from '../settingsRouteTestSupport';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

test('shows the installed application version supplied by native metadata', async () => {
  const previousMetadata = NativeModules.OrotAppMetadata;
  NativeModules.OrotAppMetadata = { version: '0.1.0' };
  try {
    await render(
      <SettingsRoute
        selectedProvider="Cached provider label"
        selectedAiResolverOptions={settingsRouteResolverOptions()}
        onOpenProviderSettings={jest.fn()}
        onOpenAccounts={jest.fn()}
        onOpenPrivacy={jest.fn()}
        onOpenBackup={jest.fn()}
        onOpenHealthData={jest.fn()}
        onOpenSyncStatus={jest.fn()}
      />,
    );

    expect(screen.getByTestId('settings-app-info')).toHaveTextContent(
      '오롯 0.1.0',
    );
    const infoText = screen.getAllByTestId('settings-app-info-text');
    expect(infoText).toHaveLength(1);
    expect(infoText[0]).toHaveTextContent('오롯 0.1.0');
  } finally {
    NativeModules.OrotAppMetadata = previousMetadata;
  }
});

test('groups destinations and preserves every Settings action', async () => {
  const onOpenHealthData = jest.fn();
  const onOpenSyncStatus = jest.fn();
  const onOpenProviderSettings = jest.fn();
  const onOpenAccounts = jest.fn();
  const onOpenPrivacy = jest.fn();
  const onOpenBackup = jest.fn();
  await render(
    <SettingsRoute
      selectedProvider="Cached provider label"
      selectedAiResolverOptions={settingsRouteResolverOptions()}
      onOpenProviderSettings={onOpenProviderSettings}
      onOpenAccounts={onOpenAccounts}
      onOpenPrivacy={onOpenPrivacy}
      onOpenBackup={onOpenBackup}
      onOpenHealthData={onOpenHealthData}
      onOpenSyncStatus={onOpenSyncStatus}
    />,
  );

  const sections = screen
    .getAllByTestId(/^settings-section-/)
    .map(section => section.props.testID);
  expect(sections).toEqual([
    'settings-section-ai-accounts',
    'settings-section-health-data',
    'settings-section-privacy-backup',
    'settings-section-daily-reminders',
    'settings-section-app-info',
  ]);
  expect(screen.getByText(t('settings.summary'))).toBeTruthy();
  expect(
    within(screen.getByTestId('settings-section-ai-accounts')).getByText(
      'AI와 계정',
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId('settings-section-health-data')).getByRole(
      'header',
      { name: '건강 데이터' },
    ),
  ).toBeTruthy();
  expect(
    within(screen.getByTestId('settings-section-privacy-backup')).getByText(
      '개인정보와 보관',
    ),
  ).toBeTruthy();
  expect(screen.getByText('AI 제공자와 모델')).toBeTruthy();
  expect(screen.getByText('연결된 계정')).toBeTruthy();
  expect(screen.getByText('개인정보 및 권한')).toBeTruthy();
  expect(screen.getByText('백업과 복구')).toBeTruthy();
  expect(
    StyleSheet.flatten(screen.getByTestId('settings-app-info-icon').props.style)
      ?.backgroundColor,
  ).toEqual(appColors.primarySoft);

  const actionIDs = [
    'settings-open-health-data',
    'settings-open-sync-status',
    'settings-open-provider',
    'settings-open-accounts',
    'settings-open-privacy',
    'settings-open-backup',
  ];
  for (const id of actionIDs) {
    expect(screen.getByTestId(id).props.accessibilityRole).toBe('button');
    await fireEvent.press(screen.getByTestId(id));
  }

  expect(onOpenHealthData).toHaveBeenCalledTimes(1);
  expect(onOpenSyncStatus).toHaveBeenCalledTimes(1);
  expect(onOpenProviderSettings).toHaveBeenCalledTimes(1);
  expect(onOpenAccounts).toHaveBeenCalledTimes(1);
  expect(onOpenPrivacy).toHaveBeenCalledTimes(1);
  expect(onOpenBackup).toHaveBeenCalledTimes(1);
});
