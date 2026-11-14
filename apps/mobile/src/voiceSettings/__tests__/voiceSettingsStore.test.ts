import { getGenericPassword, setGenericPassword } from 'react-native-keychain';
import {
  voiceSettingsStore,
  requireLocalVoiceProcessing,
} from '../voiceSettingsStore';
import { canActivateVoiceModel } from '../voiceActivation';
import { Alert } from 'react-native';

jest.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'device-only' },
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
}));
const read = jest.mocked(getGenericPassword);
const write = jest.mocked(setGenericPassword);
const api = { mode: 'openai-api' as const, model: 'gpt-realtime-2.1' };
let persisted: string | null;
beforeEach(() => {
  jest.clearAllMocks();
  persisted = null;
  read.mockImplementation(async () =>
    persisted === null ? false : ({ password: persisted } as never),
  );
  write.mockImplementation(async (_account, password) => {
    persisted = password;
    return {} as never;
  });
});
it('defaults only absent configuration to local and never exposes stored keys', async () => {
  expect(await requireLocalVoiceProcessing()).toBe(true);
  await voiceSettingsStore.save({ ...api, replacementKey: 'synthetic-key' });
  expect(await voiceSettingsStore.load()).toEqual({ ...api, hasApiKey: true });
  expect(write).toHaveBeenCalledWith('voice-settings', expect.any(String), {
    service: 'com.orot.mobile.voice-settings.v1',
    accessible: 'device-only',
  });
  expect(await requireLocalVoiceProcessing()).toBe(false);
});
it('preserves a key without retyping, removes it only explicitly, and keeps models independent', async () => {
  await voiceSettingsStore.save({ ...api, replacementKey: 'synthetic-key' });
  await voiceSettingsStore.save({ ...api, model: 'gpt-realtime-2.1-mini' });
  expect(JSON.parse(persisted!).apiKey).toBe('synthetic-key');
  await voiceSettingsStore.save({
    mode: 'local',
    model: 'apple-system-speech',
    removeKey: true,
  });
  expect(await voiceSettingsStore.load()).toEqual({
    mode: 'local',
    model: 'apple-system-speech',
    hasApiKey: false,
  });
});
it('rejects wrong model families, missing keys, corrupt data, and inaccessible Keychain', async () => {
  await expect(voiceSettingsStore.save(api)).rejects.toThrow();
  await expect(
    voiceSettingsStore.save({
      ...api,
      model: 'gpt-text',
      replacementKey: 'synthetic',
    }),
  ).rejects.toThrow();
  persisted = '{}';
  await expect(requireLocalVoiceProcessing()).rejects.toThrow();
  read.mockRejectedValue(new Error('locked'));
  await expect(requireLocalVoiceProcessing()).rejects.toThrow();
  expect(write).not.toHaveBeenCalled();
});
it('notifies current voice owners only after successful persistence', async () => {
  const changed = jest.fn();
  const unsubscribe = voiceSettingsStore.subscribe(changed);
  write.mockResolvedValueOnce(false);
  await expect(
    voiceSettingsStore.save({ ...api, replacementKey: 'synthetic' }),
  ).rejects.toThrow();
  expect(changed).not.toHaveBeenCalled();
  await voiceSettingsStore.save({ ...api, replacementKey: 'synthetic' });
  expect(changed).toHaveBeenCalledTimes(1);
  unsubscribe();
});
it('blocks Realtime activation instead of falling back or invoking a provider', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  await voiceSettingsStore.save({ ...api, replacementKey: 'synthetic' });
  expect(await canActivateVoiceModel()).toBe(false);
  expect(alert).toHaveBeenCalledTimes(1);
  await voiceSettingsStore.save({
    mode: 'local',
    model: 'apple-system-speech',
  });
  expect(await canActivateVoiceModel()).toBe(true);
  alert.mockRestore();
});
