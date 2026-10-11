import { NativeModules } from 'react-native';
import { render, screen } from '@testing-library/react-native';
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
      />,
    );

    expect(screen.getByTestId('settings-app-info')).toHaveTextContent(
      '오롯 0.1.0',
    );
  } finally {
    NativeModules.OrotAppMetadata = previousMetadata;
  }
});
