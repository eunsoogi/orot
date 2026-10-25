import { NativeModules } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SettingsRoute } from '../SettingsRoute';

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
        selectedProvider="Apple Intelligence"
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
  } finally {
    NativeModules.OrotAppMetadata = previousMetadata;
  }
});

test('keeps automatic health integrations in their own Settings group', async () => {
  const onOpenHealthData = jest.fn();
  const onOpenSyncStatus = jest.fn();
  await render(
    <SettingsRoute
      selectedProvider="Apple Intelligence"
      onOpenProviderSettings={jest.fn()}
      onOpenAccounts={jest.fn()}
      onOpenPrivacy={jest.fn()}
      onOpenBackup={jest.fn()}
      onOpenHealthData={onOpenHealthData}
      onOpenSyncStatus={onOpenSyncStatus}
    />,
  );

  expect(screen.getByText('연동')).toBeTruthy();
  expect(screen.getByTestId('settings-open-health-data')).toHaveTextContent(
    '건강 데이터앱을 열 때 자동으로 동기화해요.',
  );
  expect(screen.getByTestId('settings-open-sync-status')).toHaveTextContent(
    '권한 및 동기화 상태문제가 있으면 상태를 확인하고 다시 시도해요.',
  );
  await fireEvent.press(screen.getByTestId('settings-open-health-data'));
  await fireEvent.press(screen.getByTestId('settings-open-sync-status'));
  expect(onOpenHealthData).toHaveBeenCalledTimes(1);
  expect(onOpenSyncStatus).toHaveBeenCalledTimes(1);
});
