import { getGenericPassword, setGenericPassword } from 'react-native-keychain';
import { voiceSettingsStore } from '../voiceSettingsStore';
import { apiCredentialMutation } from '../voiceConsentIdentity';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

beforeEach(() => {
  jest.mocked(getGenericPassword).mockResolvedValue(false);
  jest.mocked(setGenericPassword).mockResolvedValue(false);
});

test('actual failed API logout invalidates live witnesses before Keychain awaits without inventing removal', async () => {
  let finishRead!: (value: false) => void;
  jest.mocked(getGenericPassword).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishRead = resolve;
      }),
  );
  const witness = apiCredentialMutation.capture()!;
  const logout = voiceSettingsStore.setAccountKey('');
  expect(witness()).toBe(false);
  expect(apiCredentialMutation.capture()).toBeNull();
  await Promise.resolve();
  await Promise.resolve();
  finishRead(false);
  await expect(logout).rejects.toThrow('could not be saved');
  expect(witness()).toBe(false);
  expect(apiCredentialMutation.capture()?.()).toBe(true);
});
