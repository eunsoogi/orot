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
        onOpenMemory={jest.fn()}
        onOpenNotifications={jest.fn()}
        onOpenPrivacyPolicy={jest.fn()}
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

test('shows one compact list and preserves each Settings destination', async () => {
  const onOpenHealthData = jest.fn();
  const onOpenSyncStatus = jest.fn();
  const onOpenProviderSettings = jest.fn();
  const onOpenAccounts = jest.fn();
  const onOpenPrivacy = jest.fn();
  const onOpenPrivacyPolicy = jest.fn();
  const onOpenMemory = jest.fn();
  const onOpenNotifications = jest.fn();
  await render(
    <SettingsRoute
      selectedProvider="Cached provider label"
      selectedAiResolverOptions={settingsRouteResolverOptions()}
      onOpenProviderSettings={onOpenProviderSettings}
      onOpenAccounts={onOpenAccounts}
      onOpenPrivacy={onOpenPrivacy}
      onOpenMemory={onOpenMemory}
      onOpenNotifications={onOpenNotifications}
      onOpenPrivacyPolicy={onOpenPrivacyPolicy}
      onOpenHealthData={onOpenHealthData}
      onOpenSyncStatus={onOpenSyncStatus}
    />,
  );

  expect(
    screen.getByRole('header', { name: t('settings.title') }),
  ).toBeTruthy();
  expect(screen.queryAllByTestId(/^settings-section-/)).toHaveLength(0);
  expect(screen.queryByText(t('settings.summary'))).toBeNull();
  expect(screen.getByTestId('settings-destinations')).toBeTruthy();
  const destinations = within(screen.getByTestId('settings-destinations'));
  expect(
    destinations
      .getAllByRole('button')
      .slice(-3)
      .map(row => row.props.accessibilityLabel),
  ).toEqual(['권한', '동기화', '개인정보 처리 방침']);
  expect(destinations.queryByTestId('settings-app-info')).toBeNull();
  expect(
    within(screen.getByTestId('settings-version-group')).getByTestId(
      'settings-app-info',
    ),
  ).toBeTruthy();
  expect(destinations.queryByTestId('settings-open-backup')).toBeNull();
  expect(screen.queryByTestId('settings-daily-reminder-switch')).toBeNull();
  expect(screen.queryAllByRole('switch')).toHaveLength(0);
  expect(screen.getByText('AI 제공자와 모델')).toBeTruthy();
  expect(screen.getByText('연결된 계정')).toBeTruthy();
  // These destinations keep their actions but no longer expose loading/account subtitles.
  expect(screen.getByTestId('settings-open-provider')).toHaveTextContent(
    /^AI 제공자와 모델$/,
  );
  expect(screen.getByTestId('settings-open-accounts')).toHaveTextContent(
    /^연결된 계정$/,
  );
  expect(screen.queryByText(t('provider.selection.rowLoading'))).toBeNull();
  expect(
    screen.queryByText(
      t('provider.selection.chatGPTAccountsConnected', { count: 1 }),
    ),
  ).toBeNull();
  expect(screen.getByText('권한')).toBeTruthy();
  expect(screen.getByText('개인정보 처리 방침')).toBeTruthy();
  expect(
    StyleSheet.flatten(screen.getByTestId('settings-app-info-icon').props.style)
      ?.backgroundColor,
  ).toEqual(appColors.primarySoft);
  expect(
    StyleSheet.flatten(screen.getByTestId('settings-app-info-icon').props.style)
      ?.width,
  ).toBe(28);

  const actionIDs = [
    'settings-open-health-data',
    'settings-open-sync-status',
    'settings-open-provider',
    'settings-open-accounts',
    'settings-open-privacy',
    'settings-open-privacy-policy',
    'settings-open-memory',
    'settings-open-notifications',
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
  expect(onOpenPrivacyPolicy).toHaveBeenCalledTimes(1);
  expect(onOpenMemory).toHaveBeenCalledTimes(1);
  expect(onOpenNotifications).toHaveBeenCalledTimes(1);
});
