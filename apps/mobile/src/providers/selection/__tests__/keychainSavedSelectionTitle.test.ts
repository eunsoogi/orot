import {
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { KeychainProviderSelectionStore } from '../keychainSelectionStore';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  getGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

const getGenericPasswordMock = jest.mocked(getGenericPassword);
const setGenericPasswordMock = jest.mocked(setGenericPassword);

it('keeps presentation restart-safe and separate from the authority-facing identity', async () => {
  jest.clearAllMocks();
  let raw: string | undefined;
  const storage = STORAGE_TYPE.AES_GCM_NO_AUTH;
  getGenericPasswordMock.mockImplementation(async () =>
    raw === undefined
      ? false
      : {
          service: 'title-probe',
          storage,
          password: raw,
          username: 'unused',
        },
  );
  setGenericPasswordMock.mockImplementation(async (_user, encoded) => {
    raw = encoded;
    return { service: 'title-probe', storage };
  });
  const initial = new KeychainProviderSelectionStore('title-probe');
  const choice = {
    providerId: 'chatgpt-plan:fixture:gpt-new',
    modelId: 'gpt-new',
  };
  await initial.save(choice);
  const prior = initial.liveWitness()!;
  await initial.rememberTitle(
    choice,
    { name: 'Saved Friendly Name', epoch: 'epoch-a' },
    () => true,
  );
  expect(prior()).toBe(true);
  const restarted = new KeychainProviderSelectionStore('title-probe');
  await expect(restarted.load()).resolves.toStrictEqual(choice);
  await expect(restarted.loadTitle(choice, 'epoch-a')).resolves.toBe(
    'Saved Friendly Name',
  );
  await expect(restarted.loadTitle(choice, 'epoch-b')).resolves.toBeUndefined();
  await expect(
    restarted.loadTitle(
      { ...choice, providerId: 'chatgpt-plan:different:gpt-new' },
      'epoch-a',
    ),
  ).resolves.toBeUndefined();

  const changed = {
    providerId: 'chatgpt-plan:fixture:gpt-later',
    modelId: 'gpt-later',
  };
  await restarted.save(changed);
  await initial.rememberTitle(
    choice,
    { name: 'Stale Title', epoch: 'epoch-a' },
    () => true,
  );
  await expect(restarted.load()).resolves.toStrictEqual(changed);
  await expect(
    restarted.loadTitle(changed, 'epoch-a'),
  ).resolves.toBeUndefined();
  expect(setGenericPasswordMock).toHaveBeenCalledTimes(3);
});
