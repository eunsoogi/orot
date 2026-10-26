import type {
  DependencyList,
  Dispatch,
  EffectCallback,
  RefObject,
  SetStateAction,
} from 'react';

jest.mock('react-native', () => ({
  AppRegistry: { registerComponent: jest.fn() },
  NativeModules: { SettingsManager: { settings: {} } },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View',
}));

jest.mock('react', () => ({
  ...jest.requireActual('react'),
  useEffect: jest.fn(),
  useRef: jest.fn(),
  useState: jest.fn(),
}));

jest.mock('react-native-get-random-values', () => ({}));

jest.mock('../e2e/backupProbe', () => ({
  getBackupProbeMode: jest.fn(),
  runBackupProbe: jest.fn(),
}));

const reactNative = require('react-native');
type ReactHookMocks = {
  useEffect: jest.Mock<void, [EffectCallback, DependencyList?]>;
  useRef: jest.Mock<RefObject<unknown>, [unknown]>;
  useState: jest.Mock<
    [unknown, Dispatch<SetStateAction<unknown>>],
    [unknown | (() => unknown)]
  >;
};

// Jest hook stubs need the real parameter and return contracts.
const react = require('react') as ReactHookMocks;
const backupProbe = require('../e2e/backupProbe');

type TestElement = {
  props?: {
    children?: unknown;
    disabled?: boolean;
    onPress?: () => void;
    testID?: string;
  };
};

function findByTestId(node: unknown, testID: string): TestElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findByTestId(child, testID);
      if (match) return match;
    }
    return undefined;
  }
  if (node === null || typeof node !== 'object') return undefined;
  const element = node as TestElement;
  if (element.props?.testID === testID) return element;
  return findByTestId(element.props?.children, testID);
}

afterEach(() => {
  jest.clearAllMocks();
});

test('does not auto-start and ignores results after teardown', async () => {
  let effect: EffectCallback | undefined;
  let resolveProbe: ((value: unknown) => void) | undefined;
  let stateCall = 0;
  const setState = jest.fn<void, [SetStateAction<unknown>]>();
  const setResult = jest.fn<void, [SetStateAction<unknown>]>();
  const result = {
    evidenceScope: 'synthetic-simulator-app-container-snapshot',
  };

  backupProbe.getBackupProbeMode.mockReturnValue('snapshot-seed');
  backupProbe.runBackupProbe.mockReturnValue(
    new Promise(resolve => {
      resolveProbe = resolve;
    }),
  );
  react.useEffect.mockImplementation(callback => {
    effect = callback;
  });
  react.useRef.mockImplementation(value => ({ current: value }));
  react.useState.mockImplementation(value => {
    stateCall += 1;
    return [value, stateCall === 1 ? setState : setResult];
  });

  require('../e2e/backupProbeEntry');
  const probe = reactNative.AppRegistry.registerComponent.mock.calls[0][1]();
  const screen = probe();
  const start = findByTestId(screen, 'backup-probe-start');
  const cleanup = effect?.();

  expect(backupProbe.runBackupProbe).not.toHaveBeenCalled();
  expect(start?.props?.disabled).toBe(false);
  start?.props?.onPress?.();
  start?.props?.onPress?.();
  expect(backupProbe.runBackupProbe).toHaveBeenCalledWith('snapshot-seed');
  expect(backupProbe.runBackupProbe).toHaveBeenCalledTimes(1);
  expect(setState).toHaveBeenCalledWith('running');

  cleanup?.();
  resolveProbe?.(result);
  await Promise.resolve();
  expect(setResult).not.toHaveBeenCalled();
  expect(setState).toHaveBeenCalledTimes(1);
});
