import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import { localVoiceModel, validVoiceModel } from './voiceModels';
import type { StoredVoiceSettings } from './voiceSettingsTypes';

/** One device-only writer for account credentials, and no read-time migration. */
export function voiceSettingsKeychainRecord(service: string) {
  return {
    async read(): Promise<StoredVoiceSettings> {
      const value = await getGenericPassword({ service });
      if (!value) return { mode: 'local', model: localVoiceModel, apiKey: '' };
      const parsed = JSON.parse(value.password) as StoredVoiceSettings;
      if (
        !parsed ||
        !['local', 'openai-api'].includes(parsed.mode) ||
        typeof parsed.model !== 'string' ||
        !validVoiceModel(parsed.mode, parsed.model) ||
        typeof parsed.apiKey !== 'string' ||
        (parsed.credentialEpoch !== undefined &&
          !/^[a-f0-9]{64}$/.test(parsed.credentialEpoch)) ||
        (parsed.pairCandidates !== undefined &&
          (!Array.isArray(parsed.pairCandidates) ||
            parsed.pairCandidates.length < 1 ||
            parsed.pairCandidates.length > 2))
      )
        throw new Error('Voice settings unavailable');
      return parsed;
    },
    async write(value: StoredVoiceSettings) {
      const saved = await setGenericPassword(
        'voice-settings',
        JSON.stringify(value),
        { service, accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
      );
      if (!saved) throw new Error('Voice settings could not be saved');
    },
  };
}
