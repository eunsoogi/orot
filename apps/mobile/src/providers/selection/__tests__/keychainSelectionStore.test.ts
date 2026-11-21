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

it('isolates calendar selection from the conversation keychain entry', async () => {
  jest.clearAllMocks();
  getGenericPasswordMock.mockResolvedValue(false);
  setGenericPasswordMock.mockResolvedValue({
    service: 'calendar',
    storage: STORAGE_TYPE.AES_GCM_NO_AUTH,
  });
  const calendar = new KeychainProviderSelectionStore(
    'com.orot.mobile.calendar-classification-selection.v1',
  );
  await expect(calendar.load()).resolves.toBeNull();
  await calendar.save({
    providerId: 'openai-api-decisions',
    modelId: 'gpt-6-luna',
  });
  expect(getGenericPasswordMock).toHaveBeenCalledWith({
    service: 'com.orot.mobile.calendar-classification-selection.v1',
  });
  expect(setGenericPasswordMock).toHaveBeenCalledWith(
    'provider-selection',
    JSON.stringify({
      providerId: 'openai-api-decisions',
      modelId: 'gpt-6-luna',
    }),
    {
      service: 'com.orot.mobile.calendar-classification-selection.v1',
      accessible: 'device-only',
    },
  );
  expect(resetGenericPasswordMock).not.toHaveBeenCalled();
});

describe('joint approval selection replacement', () => {
  const first = { providerId: 'synthetic-account-a', modelId: 'model-a' };
  const second = { providerId: 'synthetic-account-b', modelId: 'model-b' };
  const storage = STORAGE_TYPE.AES_GCM_NO_AUTH;
  let password: string | undefined;
  let writeFence: (() => Promise<void>) | undefined;
  beforeEach(() => {
    jest.clearAllMocks();
    password = undefined;
    writeFence = undefined;
    getGenericPasswordMock.mockImplementation(async () =>
      password === undefined
        ? false
        : {
            service: 'isolated',
            storage,
            password,
            username: 'provider-selection',
          },
    );
    setGenericPasswordMock.mockImplementation(async (_user, value) => {
      await writeFence?.();
      password = value;
      return { service: 'isolated', storage };
    });
    resetGenericPasswordMock.mockImplementation(async () => {
      password = undefined;
      return true;
    });
  });

  it('allows a true empty slot and only the returned exact writer can compensate', async () => {
    const store = new KeychainProviderSelectionStore('isolated');
    const original = store.liveWitness()!;
    const owned = await store.replaceOwned(null, first, original, () => true);
    expect(original()).toBe(false);
    expect(owned?.()).toBe(true);
    expect(await store.load()).toEqual(first);
    await expect(
      store.replaceOwned(first, null, original, () => true),
    ).resolves.toBeNull();
    expect(await store.load()).toEqual(first);
    const cleared = await store.replaceOwned(first, null, owned!, () => true);
    expect(cleared?.()).toBe(true);
    expect(await store.load()).toBeNull();
  });

  it('does not replace a corrupt slot or a known different owner as initial setup', async () => {
    const store = new KeychainProviderSelectionStore('isolated');
    for (const saved of ['not-json', JSON.stringify(second)]) {
      password = saved;
      await expect(
        store.replaceOwned(null, first, store.liveWitness()!, () => true),
      ).resolves.toBeNull();
      expect(password).toBe(saved);
    }
    expect(setGenericPasswordMock).not.toHaveBeenCalled();
  });

  it('a slow staging write cannot regain ownership or overwrite a newer native clear/change', async () => {
    const store = new KeychainProviderSelectionStore('isolated');
    await store.save(first);
    let started!: () => void;
    const entered = new Promise<void>(resolve => {
      started = resolve;
    });
    let resume!: () => void;
    const release = new Promise<void>(resolve => {
      resume = resolve;
    });
    writeFence = async () => {
      started();
      await release;
    };
    const pending = store.replaceOwned(
      first,
      second,
      store.liveWitness()!,
      () => true,
    );
    await entered;
    const clearing = store.clear();
    const newest = store.save(first);
    expect(store.liveWitness()).toBeNull();
    writeFence = undefined;
    resume();
    await expect(pending).resolves.toBeNull();
    await clearing;
    await newest;
    expect(await store.load()).toEqual(first);
    expect(setGenericPasswordMock).toHaveBeenCalledTimes(3);
  });
});
