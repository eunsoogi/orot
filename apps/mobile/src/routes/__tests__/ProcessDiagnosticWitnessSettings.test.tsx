import { NativeModules } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { markProcessDiagnosticBridge } from '../../providers/processDiagnosticWitness';
import { SettingsRoute } from '../SettingsRoute';
import { settingsRouteResolverOptions } from '../settingsRouteTestSupport';

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../layout/AppSymbol', () => ({ AppSymbol: () => null }));
jest.mock('../../navigation', () => ({
  useNavigationLeaveStateRegistration: jest.fn(),
}));

const previousSink = NativeModules.OrotProviderDiagnostics;
const section = 'settings-process-diagnostic-witness';
const readAction = 'settings-read-process-diagnostic-witness';

afterEach(() => {
  NativeModules.OrotProviderDiagnostics = previousSink;
});

function openSettings() {
  return render(
    <SettingsRoute
      selectedProvider="Cached provider label"
      selectedAiResolverOptions={settingsRouteResolverOptions()}
      onOpenProviderSettings={jest.fn()}
      onOpenAccounts={jest.fn()}
      onOpenPrivacy={jest.fn()}
      onOpenMemory={jest.fn()}
      onOpenDisplayMode={() => {}}
      onOpenNotifications={jest.fn()}
      onOpenPrivacyPolicy={jest.fn()}
      onOpenHealthData={jest.fn()}
      onOpenSyncStatus={jest.fn()}
    />,
  );
}

test('a normal launch renders no diagnostic UI and submits no handshake or snapshot request', async () => {
  const report = jest.fn();
  const readProcessWitness = jest.fn();
  NativeModules.OrotProviderDiagnostics = {
    enabled: false,
    report,
    readProcessWitness,
  };
  markProcessDiagnosticBridge();
  await openSettings();
  expect(screen.getByTestId('settings-app-info')).toBeVisible();
  expect(screen.queryByTestId(section)).toBeNull();
  expect(report).not.toHaveBeenCalled();
  expect(readProcessWitness).not.toHaveBeenCalled();
});

test('diagnostic launch exposes fixed receipts only after an explicit read', async () => {
  const report = jest.fn();
  const readProcessWitness = jest
    .fn()
    .mockResolvedValueOnce({ launch: true, bridge: false, receipts: [] })
    .mockResolvedValueOnce({
      launch: true,
      bridge: true,
      receipts: [
        'workout native available',
        'records recent_records_source_read failed',
      ],
    });
  NativeModules.OrotProviderDiagnostics = {
    enabled: true,
    report,
    readProcessWitness,
  };
  markProcessDiagnosticBridge();
  expect(report).toHaveBeenCalledWith(
    'pipeline',
    'rn_bridge_attached',
    'completed',
  );
  await openSettings();
  expect(screen.getByTestId(section)).toBeVisible();
  expect(readProcessWitness).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId(readAction));
  expect(await screen.findByText('앱 시작 확인')).toBeVisible();
  expect(screen.getByText('JS 연결 확인 안 됨')).toBeVisible();
  await fireEvent.press(screen.getByTestId(readAction));
  expect(await screen.findByText('JS 연결 확인')).toBeVisible();
  expect(screen.getByText('workout native available')).toBeVisible();
  expect(
    screen.getByText('records recent_records_source_read failed'),
  ).toBeVisible();
  expect(readProcessWitness).toHaveBeenCalledTimes(2);
});

test.each(['unrecognized', 'oversized', 'rejected'])(
  'fails closed for a %s snapshot without displaying raw bridge details',
  async failure => {
    const readProcessWitness = jest.fn(async () => {
      if (failure === 'rejected') throw new Error('private exception');
      return {
        launch: true,
        bridge: true,
        receipts:
          failure === 'oversized'
            ? Array(33).fill('workout native available')
            : ['records recent_records_source_read 88 BPM'],
      };
    });
    NativeModules.OrotProviderDiagnostics = {
      enabled: true,
      readProcessWitness,
    };
    await openSettings();
    await fireEvent.press(screen.getByTestId(readAction));
    expect(
      await screen.findByText('진단 상태를 확인할 수 없어요.'),
    ).toBeVisible();
    expect(
      screen.queryByText(/88 BPM|private exception|workout native/),
    ).toBeNull();
  },
);
