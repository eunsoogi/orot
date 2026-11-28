import {
  getGenericPassword,
  setGenericPassword,
  STORAGE_TYPE,
} from 'react-native-keychain';
import { createVoiceSettingsStore } from '../createVoiceSettingsStore';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  STORAGE_TYPE: { AES_GCM_NO_AUTH: 'KeystoreAESGCM_NoAuth' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));

const service = 'synthetic-voice-settings';
const reopen = () =>
  createVoiceSettingsStore({
    service,
    beginSettingsMutation: () => () => {},
    beginCredentialMutation: () => () => {},
  });

const items = new Map<string, { username: string; password: string }>();
const auth = (credentialEpoch: string, apiKey: string) =>
  items.set(service, {
    username: 'voice-settings',
    password: JSON.stringify({
      mode: 'local',
      model: 'apple-system-speech',
      apiKey,
      credentialEpoch,
    }),
  });

const failed = () => ({
  url: 'https://api.openai.com/v1/models',
  ok: false,
  status: 401,
});
const success = () => ({
  url: 'https://api.openai.com/v1/models',
  ok: true,
  status: 200,
  json: async () => ({
    data: ['gpt-live-1.1', 'gpt-6-sol', 'other'].map(id => ({ id })),
  }),
});
beforeEach(() => {
  items.clear();
  jest.mocked(getGenericPassword).mockImplementation(async options => {
    const item = items.get(options?.service ?? '');
    return item
      ? {
          service: options?.service ?? '',
          storage: STORAGE_TYPE.AES_GCM_NO_AUTH,
          ...item,
        }
      : false;
  });
  jest
    .mocked(setGenericPassword)
    .mockImplementation(async (username, password, options) => {
      const id = options?.service ?? '';
      items.set(id, { username, password });
      return { service: id, storage: STORAGE_TYPE.AES_GCM_NO_AUTH };
    });
});
afterEach(() => jest.restoreAllMocks());

test('retains only recognized display rows across a new store and a failed refresh, not across a new credential', async () => {
  const epoch = 'a'.repeat(64);
  auth(epoch, 'synthetic-original-key');
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(success() as Response);
  await reopen().refreshDisplayModels(new AbortController().signal);
  const cold = reopen();
  expect(await cold.loadDisplayModelCatalog(0)).toEqual([
    'gpt-live-1.1',
    'gpt-6-sol',
  ]);
  expect(request).toHaveBeenCalledTimes(1);

  const cache = [...items].filter(([id]) => id !== service);
  expect(cache).toHaveLength(1);
  expect(cache[0]?.[1].password).not.toContain('synthetic-original-key');
  expect(cache[0]?.[1].password).not.toContain('other');

  request.mockResolvedValueOnce(failed() as Response);
  await expect(
    cold.refreshDisplayModels(new AbortController().signal),
  ).rejects.toThrow('access');
  expect(await reopen().loadDisplayModelCatalog(0)).toEqual([
    'gpt-live-1.1',
    'gpt-6-sol',
  ]);
  auth('b'.repeat(64), 'synthetic-replacement-key');
  expect(await reopen().loadDisplayModelCatalog(0)).toEqual([]);
  expect(request).toHaveBeenCalledTimes(2);
});

test('does not read back a held cache result under a replaced credential with the same numerical revision', async () => {
  auth('a'.repeat(64), 'synthetic-original-key');
  const request = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(success() as Response);
  await reopen().refreshDisplayModels(new AbortController().signal);
  const actual = jest.mocked(getGenericPassword).getMockImplementation()!;
  let release = () => {};
  let reached = () => {};
  const barrier = new Promise<void>(resolve => {
    release = resolve;
  });
  const called = new Promise<void>(resolve => {
    reached = resolve;
  });
  jest.mocked(getGenericPassword).mockImplementation(async options => {
    const old = await actual(options);
    if (options?.service?.includes('model-catalog-display')) {
      reached();
      await barrier;
    }
    return old;
  });
  const pending = reopen().loadDisplayModelCatalog(0);
  await called;
  auth('b'.repeat(64), 'synthetic-replacement-key');
  release();
  expect(await pending).toEqual([]);
  expect(request).toHaveBeenCalledTimes(1);
});

test('shared account discovery does not publish the Voice tab’s display cache', async () => {
  auth('a'.repeat(64), 'synthetic-original-key');
  jest.spyOn(globalThis, 'fetch').mockResolvedValueOnce(success() as Response);
  const current = reopen();
  await current.discoverModels(new AbortController().signal);
  expect(await current.loadDisplayModelCatalog(0)).toEqual([]);
  expect(items.size).toBe(1);
});
