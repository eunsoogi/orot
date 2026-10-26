import {
  getGenericPassword,
  resetGenericPassword,
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
const resetGenericPasswordMock = jest.mocked(resetGenericPassword);

describe('KeychainProviderSelectionStore', () => {
  beforeEach(() => jest.clearAllMocks());

  it('stores and loads only the provider and model identifiers', async () => {
    const selection = {
      providerId: 'chatgpt-plan:opaque-account:gpt-synthetic',
      modelId: 'gpt-synthetic',
    };
    setGenericPasswordMock.mockResolvedValue({
      service: 'selection',
      storage: STORAGE_TYPE.AES_GCM_NO_AUTH,
    });
    getGenericPasswordMock.mockResolvedValue({
      username: 'provider-selection',
      password: JSON.stringify(selection),
      service: 'selection',
      storage: STORAGE_TYPE.AES_GCM_NO_AUTH,
    });
    const store = new KeychainProviderSelectionStore();

    await store.save(selection);

    expect(setGenericPasswordMock).toHaveBeenCalledWith(
      'provider-selection',
      JSON.stringify(selection),
      expect.objectContaining({
        service: 'com.orot.mobile.provider-selection.v1',
        accessible: 'device-only',
      }),
    );
    await expect(store.load()).resolves.toEqual(selection);
    expect(getGenericPasswordMock).toHaveBeenCalledWith({
      service: 'com.orot.mobile.provider-selection.v1',
    });
  });

  it('does not restore malformed or credential-bearing data as a provider selection', async () => {
    getGenericPasswordMock.mockResolvedValue({
      username: 'provider-selection',
      password: JSON.stringify({
        providerId: 'chatgpt-plan:account:gpt-synthetic',
        modelId: 'gpt-synthetic',
        accessToken: 'must-not-be-used',
      }),
      service: 'selection',
      storage: STORAGE_TYPE.AES_GCM_NO_AUTH,
    });
    const store = new KeychainProviderSelectionStore();

    await expect(store.load()).resolves.toBeNull();
  });

  it('removes only its own Keychain selection entry', async () => {
    resetGenericPasswordMock.mockResolvedValue(true);
    const store = new KeychainProviderSelectionStore();

    await store.clear();

    expect(resetGenericPasswordMock).toHaveBeenCalledWith({
      service: 'com.orot.mobile.provider-selection.v1',
    });
  });
});
