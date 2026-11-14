import { getGenericPassword, setGenericPassword } from 'react-native-keychain';
import { voiceSettingsStore } from '../voiceSettingsStore';
jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
let saved: string;
const originalFetch = globalThis.fetch;
const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  saved = JSON.stringify({
    mode: 'openai-api',
    model: 'gpt-realtime-2.1',
    apiKey: 'synthetic-old',
  });
  jest
    .mocked(getGenericPassword)
    .mockImplementation(async () => ({ password: saved }) as never);
  jest.mocked(setGenericPassword).mockImplementation(async (_name, value) => {
    saved = value;
    return {} as never;
  });
  globalThis.fetch = fetchMock;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
});
it('reuses the existing protected credential without migration or duplicate copies', async () => {
  expect((await voiceSettingsStore.accountStatus()).connected).toBe(true);
  expect(setGenericPassword).not.toHaveBeenCalled();
  await voiceSettingsStore.setAccountKey('synthetic-new');
  expect(setGenericPassword).toHaveBeenCalledWith(
    'voice-settings',
    expect.any(String),
    { service: 'com.orot.mobile.voice-settings.v1', accessible: 'device-only' },
  );
  expect(JSON.parse(saved)).toEqual({
    mode: 'openai-api',
    model: 'gpt-realtime-2.1',
    apiKey: 'synthetic-new',
  });
  await voiceSettingsStore.setAccountKey('');
  expect(await voiceSettingsStore.load()).toEqual({
    mode: 'openai-api',
    model: 'gpt-realtime-2.1',
    hasApiKey: false,
  });
  await expect(
    voiceSettingsStore.realtimeCredentials('gpt-realtime-2.1'),
  ).rejects.toThrow();
});
it('preserves legacy credential and revision when a write fails', async () => {
  const before = await voiceSettingsStore.accountStatus();
  jest.mocked(setGenericPassword).mockResolvedValueOnce(false);
  await expect(
    voiceSettingsStore.setAccountKey('synthetic-new'),
  ).rejects.toThrow();
  expect(await voiceSettingsStore.accountStatus()).toEqual(before);
  expect(JSON.parse(saved).apiKey).toBe('synthetic-old');
});
it('uses only model discovery and returns sanitized IDs, not secrets or provider bodies', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        { id: 'gpt-realtime-2.1' },
        { id: 'gpt-realtime-2.1' },
        { id: 'invalid\nvalue' },
      ],
    }),
  });
  const result = await voiceSettingsStore.discoverModels(
    new AbortController().signal,
  );
  expect(result.ids).toEqual(['gpt-realtime-2.1']);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://api.openai.com/v1/models',
    expect.objectContaining({
      headers: { Authorization: 'Bearer synthetic-old' },
      redirect: 'error',
    }),
  );
  expect(JSON.stringify(result)).not.toContain('synthetic-old');
});
it.each([
  [401, 'access'],
  [403, 'access'],
  [429, 'rate-limit'],
  [500, 'server'],
])('redacts HTTP %s errors', async (status, error) => {
  const json = jest.fn();
  fetchMock.mockResolvedValue({ ok: false, status, json });
  await expect(
    voiceSettingsStore.discoverModels(new AbortController().signal),
  ).rejects.toThrow(String(error));
  expect(json).not.toHaveBeenCalled();
});
it('rejects stale discovery after the connected credential changes', async () => {
  let resolve!: (value: unknown) => void;
  fetchMock.mockReturnValue(
    new Promise(r => {
      resolve = r;
    }),
  );
  const result = voiceSettingsStore.discoverModels(
    new AbortController().signal,
  );
  await new Promise<void>(r => setImmediate(() => r()));
  await voiceSettingsStore.setAccountKey('synthetic-new');
  resolve({
    ok: true,
    json: async () => ({ data: [{ id: 'gpt-realtime-2.1' }] }),
  });
  await expect(result).rejects.toThrow('account-changed');
});
it('does not contact the network for missing or malformed credentials', async () => {
  for (const apiKey of ['', 'bad\nkey']) {
    saved = JSON.stringify({
      mode: 'local',
      model: 'apple-system-speech',
      apiKey,
    });
    await expect(
      voiceSettingsStore.discoverModels(new AbortController().signal),
    ).rejects.toThrow();
  }
  expect(fetchMock).not.toHaveBeenCalled();
});
it('does not commit a model from a previous account catalog after replacement', async () => {
  const before = await voiceSettingsStore.accountStatus();
  await voiceSettingsStore.setAccountKey('synthetic-new');
  await expect(
    voiceSettingsStore.save({
      mode: 'openai-api',
      model: 'gpt-realtime-2.1-mini',
      expectedAccountRevision: before.revision,
    }),
  ).rejects.toThrow('API account changed');
  expect((await voiceSettingsStore.load()).model).toBe('gpt-realtime-2.1');
});
