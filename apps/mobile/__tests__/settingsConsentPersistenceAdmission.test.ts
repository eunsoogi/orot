// Admission is checked before any native I/O; platform polyfills are not exercised here.
jest.mock('../src/agent/polyfills', () => ({}));
jest.mock('@op-engineering/op-sqlite', () => ({}));
import { NativeModules } from 'react-native';
import { runSettingsConsentPersistenceOperation } from '../e2e/settingsConsentPersistenceOperation';
import { openSettingsConsentNativeStore } from '../e2e/settingsConsentNativeStore';

jest.mock('../e2e/settingsConsentNativeStore', () => ({
  ...jest.requireActual('../e2e/settingsConsentNativeStore'),
  openSettingsConsentNativeStore: jest.fn(),
}));
const valid = {
  synthetic: 'settings-consent',
  fixtureIdentifier:
    'test-settings-consent-12345678-1234-4234-8234-123456789abc',
  phase: 'inspect',
};
afterEach(() => jest.clearAllMocks());

test.each([
  { ...valid, synthetic: undefined },
  { ...valid, fixtureIdentifier: '../app' },
  { ...valid, phase: 'unknown' },
])(
  'invalid explicit fixture admission never opens protected storage: %j',
  async input => {
    const prior = NativeModules.OrotTestControl;
    NativeModules.OrotTestControl = {};
    try {
      await expect(
        runSettingsConsentPersistenceOperation(input),
      ).rejects.toThrow();
      expect(openSettingsConsentNativeStore).not.toHaveBeenCalled();
    } finally {
      NativeModules.OrotTestControl = prior;
    }
  },
);
test('synthetic flags without a native test host never open protected storage', async () => {
  const prior = NativeModules.OrotTestControl;
  delete NativeModules.OrotTestControl;
  try {
    await expect(
      runSettingsConsentPersistenceOperation(valid),
    ).rejects.toThrow();
    expect(openSettingsConsentNativeStore).not.toHaveBeenCalled();
  } finally {
    NativeModules.OrotTestControl = prior;
  }
});
