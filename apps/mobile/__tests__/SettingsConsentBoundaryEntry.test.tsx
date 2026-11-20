import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { SettingsConsentBoundaryEntry } from '../e2e/SettingsConsentBoundaryEntry';
import { openSettingsCredentialNativeFixture } from '../e2e/settingsCredentialNativeFixture';
import { nativeRealtimeVoice } from '../src/voiceConversation/nativeRealtimeVoice';

jest.mock('@op-engineering/op-sqlite', () => ({}));
jest.mock('../e2e/settingsCredentialNativeFixture', () => ({
  openSettingsCredentialNativeFixture: jest.fn(),
}));
jest.mock('../src/voiceConversation/nativeRealtimeVoice', () => ({
  nativeRealtimeVoice: jest.fn(),
}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const original = {
  settings: NativeModules.SettingsManager,
  test: NativeModules.OrotTestControl,
  voice: NativeModules.VoiceRealtimeModule,
};
const flags = {
  OROT_TEST_SCENARIO: 'settings-provider-layout',
  OROT_SETTINGS_CONSENT: 'synthetic',
  OROT_SETTINGS_CONSENT_BOUNDARIES: 'synthetic',
  OROT_SETTINGS_CONSENT_FIXTURE:
    'test-settings-consent-12345678-1234-4234-8234-123456789abc',
  OROT_SETTINGS_CONSENT_PHASE: 'create',
};
beforeEach(() => {
  jest.clearAllMocks();
  NativeModules.SettingsManager = { settings: { ...flags } };
  NativeModules.OrotTestControl = {};
  NativeModules.VoiceRealtimeModule = {
    settingsConsentSnapshot: jest.fn(async () => ({ synthetic: true })),
  };
});
afterEach(() => {
  NativeModules.SettingsManager = original.settings;
  NativeModules.OrotTestControl = original.test;
  NativeModules.VoiceRealtimeModule = original.voice;
});

test.each(['flag', 'uuid', 'host', 'bridge'])(
  'invalid %s fails before isolated storage or native call',
  async kind => {
    if (kind === 'flag')
      NativeModules.SettingsManager.settings.OROT_SETTINGS_CONSENT_BOUNDARIES =
        '';
    if (kind === 'uuid')
      NativeModules.SettingsManager.settings.OROT_SETTINGS_CONSENT_FIXTURE =
        '../production';
    if (kind === 'host') delete NativeModules.OrotTestControl;
    if (kind === 'bridge')
      delete NativeModules.VoiceRealtimeModule.settingsConsentSnapshot;
    const view = await render(<SettingsConsentBoundaryEntry />);
    await waitFor(() =>
      expect(view.getByTestId('settings-boundary-status')).toHaveTextContent(
        'synthetic-boundary-failed',
      ),
    );
    expect(openSettingsCredentialNativeFixture).not.toHaveBeenCalled();
    expect(nativeRealtimeVoice).not.toHaveBeenCalled();
    await view.unmount();
  },
);

// Native port is mocked here. Only the actual Simulator case proves bridge delivery.
test('real lease forwards revoke to native stop before inspecting late events', async () => {
  let current = true;
  let invalidated: (() => void) | undefined;
  const stop = jest.fn(async () => {});
  const open = jest.fn(async () => {});
  jest.mocked(nativeRealtimeVoice).mockReturnValue({ stop, open } as never);
  jest.mocked(openSettingsCredentialNativeFixture).mockResolvedValue({
    initializeAndApprove: async () => ({ ready: true }),
    close: jest.fn(),
    authorization: () => ({
      authorize: async () => 'authorized',
      isAuthorizationCurrent: () => current,
      subscribeAuthorizationInvalidation: (
        _request: unknown,
        listener: () => void,
      ) => {
        invalidated = listener;
        return () => {};
      },
    }),
    revoke: async () => {
      current = false;
      invalidated?.();
    },
  } as never);
  const view = await render(<SettingsConsentBoundaryEntry />);
  await waitFor(() =>
    expect(view.getByTestId('settings-boundary-open')).toBeTruthy(),
  );
  await fireEvent.press(view.getByTestId('settings-boundary-open'));
  expect(open).toHaveBeenCalledTimes(1);
  await fireEvent.press(view.getByTestId('settings-boundary-revoke'));
  expect(stop).toHaveBeenCalledWith('settings-consent-boundary');
  expect(
    NativeModules.VoiceRealtimeModule.settingsConsentSnapshot,
  ).toHaveBeenLastCalledWith(true);
  await view.unmount();
});
