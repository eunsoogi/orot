import type { ComponentType } from 'react';
import { AppRegistry, NativeModules } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { renderApplicationForTest } from '../e2e/testApplicationRenderer';

jest.mock('../src/agent/polyfills', () => ({}));
jest.mock('../e2e/testOperationRunner', () => ({
  startTestOperationRunner: jest.fn(() => () => {}),
}));
jest.mock('../App', () => {
  const React = require('react') as typeof import('react');
  const { Text } = require('react-native') as typeof import('react-native');
  return {
    __esModule: true,
    default: () =>
      React.createElement(
        Text,
        { testID: 'application-under-test' },
        'Application fixture',
      ),
  };
});

test('keeps domain operations isolated until the native test explicitly requests the application', async () => {
  const previous = NativeModules.SettingsManager;
  Object.defineProperty(NativeModules, 'SettingsManager', {
    configurable: true,
    value: { settings: { OROT_TEST_HOST: 'YES' } },
  });
  const register = jest.spyOn(AppRegistry, 'registerComponent');
  try {
    require('../e2e/testEntry');
    const provider = register.mock.calls.at(-1)?.[1];
    const Host = provider?.() as ComponentType;
    const result = await render(<Host />);
    expect(screen.getByTestId('integration-test-host')).toBeTruthy();
    expect(screen.queryByTestId('application-under-test')).toBeNull();
    await act(async () => {
      renderApplicationForTest();
    });
    expect(screen.getByTestId('application-under-test')).toBeTruthy();
    await result.unmount();
    expect(() => renderApplicationForTest()).toThrow('renderer is unavailable');
  } finally {
    register.mockRestore();
    Object.defineProperty(NativeModules, 'SettingsManager', {
      configurable: true,
      value: previous,
    });
  }
});
