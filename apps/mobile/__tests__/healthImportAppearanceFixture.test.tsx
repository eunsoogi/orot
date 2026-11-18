import { act, render, screen, waitFor } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import { prepareHealthImportAppearance } from '../e2e/healthImportAppearanceFixture';
import { appearanceStore } from '../src/assistantAppearance/appearanceStore';

jest.mock('../src/assistantAppearance/appearanceStore', () => ({
  appearanceStore: { load: jest.fn(), save: jest.fn() },
}));
jest.mock('../App', () => {
  const { Text } = require('react-native');
  return () => <Text testID="prepared-app">App</Text>;
});
const optedIn = {
  OROT_TEST_SCENARIO: 'common-observations',
  OROT_HEALTH_IMPORT_APPEARANCE: 'synthetic',
};
const prepare = jest.fn();
const remove = jest.fn();
NativeModules.HealthKitModule = {
  prepareSyntheticFixtures: prepare,
  removeSyntheticFixture: remove,
};
const { HealthKitFixtureApp } = require('../e2e/HealthKitFixtureApp');
const features = ['heartRate'] as const;

beforeEach(() => {
  jest.clearAllMocks();
  NativeModules.SettingsManager = { settings: optedIn };
  prepare.mockResolvedValue({ mode: 'synthetic' });
  remove.mockResolvedValue(undefined);
  jest.mocked(appearanceStore.load).mockResolvedValue(null);
  jest
    .mocked(appearanceStore.save)
    .mockResolvedValue({ avatar: 'neutral', name: null });
});

test.each([
  undefined,
  {},
  { ...optedIn, OROT_HEALTH_IMPORT_APPEARANCE: undefined },
  { ...optedIn, OROT_TEST_SCENARIO: 'unified-import' },
])(
  'does not touch preferences outside the explicit health-import launch: %p',
  async settings => {
    await prepareHealthImportAppearance(settings, appearanceStore);
    expect(appearanceStore.load).not.toHaveBeenCalled();
    expect(appearanceStore.save).not.toHaveBeenCalled();
  },
);

test('preserves an existing configured choice', async () => {
  jest
    .mocked(appearanceStore.load)
    .mockResolvedValue({ avatar: 'neutral', name: 'Synthetic choice' });
  await prepareHealthImportAppearance(optedIn, appearanceStore);
  expect(appearanceStore.save).not.toHaveBeenCalled();
});

test('waits for the encrypted preference commit before mounting App', async () => {
  let commit!: () => void;
  jest.mocked(appearanceStore.save).mockImplementation(
    () =>
      new Promise(resolve => {
        commit = () => resolve({ avatar: 'neutral', name: null });
      }),
  );
  await render(<HealthKitFixtureApp features={features} />);
  await waitFor(() =>
    expect(appearanceStore.save).toHaveBeenCalledWith({
      avatar: 'neutral',
      name: null,
    }),
  );
  expect(screen.queryByTestId('prepared-app')).toBeNull();
  await act(async () => commit());
  expect(screen.getByTestId('prepared-app')).toBeTruthy();
});

test.each(['load', 'save'] as const)(
  'does not mount App when appearance %s fails',
  async operation => {
    jest
      .mocked(appearanceStore[operation])
      .mockRejectedValue(new Error('synthetic failure'));
    await render(<HealthKitFixtureApp features={features} />);
    await waitFor(() =>
      expect(
        screen.getByTestId('healthkit-fixture-status').props.children,
      ).toBe('failed'),
    );
    expect(screen.queryByTestId('prepared-app')).toBeNull();
  },
);

test('does not mount after unmount while a commit is pending and releases synthetic samples', async () => {
  let commit!: () => void;
  jest.mocked(appearanceStore.save).mockImplementation(
    () =>
      new Promise(resolve => {
        commit = () => resolve({ avatar: 'neutral', name: null });
      }),
  );
  const view = await render(<HealthKitFixtureApp features={features} />);
  await waitFor(() => expect(appearanceStore.save).toHaveBeenCalled());
  await view.unmount();
  await act(async () => commit());
  expect(remove).toHaveBeenCalled();
});

test('prepares the explicitly opted-in blood-pressure scenario', async () => {
  await prepareHealthImportAppearance(
    { ...optedIn, OROT_TEST_SCENARIO: 'blood-pressure' },
    appearanceStore,
  );
  expect(appearanceStore.save).toHaveBeenCalledWith({
    avatar: 'neutral',
    name: null,
  });
});

test('reads settings from native getConstants when the direct field is absent', async () => {
  NativeModules.SettingsManager = {
    getConstants: () => ({ settings: optedIn }),
  };
  await render(<HealthKitFixtureApp features={features} />);
  await waitFor(() => expect(screen.getByTestId('prepared-app')).toBeTruthy());
  expect(appearanceStore.save).toHaveBeenCalledWith({
    avatar: 'neutral',
    name: null,
  });
});

test('rejects a nonsynthetic native response before touching appearance', async () => {
  prepare.mockResolvedValue({ mode: 'real' });
  await render(<HealthKitFixtureApp features={features} />);
  await waitFor(() =>
    expect(screen.getByTestId('healthkit-fixture-status').props.children).toBe(
      'failed',
    ),
  );
  expect(appearanceStore.load).not.toHaveBeenCalled();
  expect(appearanceStore.save).not.toHaveBeenCalled();
  expect(screen.queryByTestId('prepared-app')).toBeNull();
});
