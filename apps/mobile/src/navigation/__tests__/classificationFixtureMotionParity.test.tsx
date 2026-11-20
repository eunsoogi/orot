import { act, render, screen } from '@testing-library/react-native';
import type { ComponentType } from 'react';
import { AccessibilityInfo, AppRegistry, NativeModules } from 'react-native';

jest.mock('../../agent/polyfills', () => ({}));
jest.mock('react-native-get-random-values', () => ({}));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
const mockClose = jest.fn();
jest.mock('../../../e2e/settingsConsentNativeStore', () => ({
  consentFixtureIdentity: (value: string) => value,
  openSettingsConsentNativeStore: jest.fn(async () => ({ close: mockClose })),
}));
jest.mock('../../../e2e/settingsConsentUiServices', () => ({
  createSettingsConsentUiServices: () => ({
    services: {},
    fixture: { authorizationServices: () => ({}) },
  }),
}));
// Consent service internals are outside this motion wiring contract.
jest.mock('../../agent/execution/ModelSettingsServices', () => ({
  ModelSettingsServicesContext: require('react').createContext(null),
}));
jest.mock('../../agent/execution/SettingsConsentReadServices', () => ({
  SettingsConsentReadServicesContext: require('react').createContext(null),
}));
jest.mock('../../../e2e/ClassificationProbeScreen', () => {
  const React = require('react');
  const { Text } = require('react-native');
  const { NavigationMotionContext } = require('../NavigationMotionContext');
  return {
    ClassificationProbeScreen: () => (
      <Text>
        {React.useContext(NavigationMotionContext) ? 'motion on' : 'motion off'}
      </Text>
    ),
  };
});

// Exercise the registered fixture entry and real production hook. Mocked bridge
// events prove wiring only; actual OS state and native fades still need XCTest.
test('classification fixture propagates the system snapshot and subsequent changes, then cleans up', async () => {
  const priorSettings = NativeModules.SettingsManager;
  const priorControl = NativeModules.OrotTestControl;
  NativeModules.SettingsManager = {
    settings: {
      OROT_E2E_PROBE: 'medical-appointment-classification',
      OROT_SETTINGS_CONSENT_FIXTURE:
        'test-settings-consent-00000000-0000-0000-0000-000000000000',
      OROT_SETTINGS_CONSENT_PHASE: 'create',
    },
  };
  NativeModules.OrotTestControl = {};
  const remove = jest.fn();
  const listener = jest
    .spyOn(AccessibilityInfo, 'addEventListener')
    .mockReturnValue({ remove });
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockResolvedValue(true);
  const register = jest.spyOn(AppRegistry, 'registerComponent');
  let view: Awaited<ReturnType<typeof render>> | undefined;
  try {
    require('../../../e2e/medicalAppointmentClassificationProbeEntry');
    const factory = register.mock.calls.at(-1)?.[1];
    if (!factory) throw new Error('Classification entry was not registered');
    const Entry = factory() as ComponentType;
    view = await render(<Entry />);
    expect(await screen.findByText('motion on')).toBeTruthy();
    expect(AccessibilityInfo.isReduceMotionEnabled).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      'reduceMotionChanged',
      expect.any(Function),
    );
    const onChange = listener.mock.calls[0][1] as (value: boolean) => void;
    await act(async () => onChange(false));
    expect(screen.getByText('motion off')).toBeTruthy();
    await act(async () => onChange(true));
    expect(screen.getByText('motion on')).toBeTruthy();
    await view.unmount();
    view = undefined;
    expect(remove).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  } finally {
    await view?.unmount();
    jest.restoreAllMocks();
    NativeModules.SettingsManager = priorSettings;
    NativeModules.OrotTestControl = priorControl;
  }
});
