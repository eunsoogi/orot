import { localVoiceModel, validVoiceModel } from './voiceModels';
import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';

export type VoiceMode = 'local' | 'openai-api';
export interface VoiceSettings {
  readonly mode: VoiceMode;
  readonly model: string;
  readonly hasApiKey: boolean;
}
interface StoredVoiceSettings {
  mode: VoiceMode;
  model: string;
  apiKey: string;
}
const service = 'com.orot.mobile.voice-settings.v1';
const listeners = new Set<() => void>();
let saving: Promise<void> = Promise.resolve();
const defaults: StoredVoiceSettings = {
  mode: 'local',
  model: localVoiceModel,
  apiKey: '',
};

/** Invalid or inaccessible state fails closed, never changes the processing destination. */
async function read(): Promise<StoredVoiceSettings> {
  const value = await getGenericPassword({ service });
  if (!value) return { ...defaults };
  const parsed = JSON.parse(value.password) as StoredVoiceSettings;
  if (
    !parsed ||
    !['local', 'openai-api'].includes(parsed.mode) ||
    typeof parsed.model !== 'string' ||
    !validVoiceModel(parsed.mode, parsed.model) ||
    typeof parsed.apiKey !== 'string'
  ) {
    throw new Error('Voice settings unavailable');
  }
  return parsed;
}

/** Keep credentials out of React state and saved-settings readbacks. No network validation occurs. */
export const voiceSettingsStore = {
  async load(): Promise<VoiceSettings> {
    const value = await read();
    return {
      mode: value.mode,
      model: value.model,
      hasApiKey: Boolean(value.apiKey),
    };
  },
  /** Reads only for the explicitly selected Realtime model after caller-owned audio consent.
   * This is not a consent grant or a network validity check. Keep the returned secret
   * out of React state, persistence, errors and logs; discard it after authentication.
   */
  async realtimeCredentials(
    expectedModel: string,
  ): Promise<{ model: string; apiKey: string }> {
    try {
      // A selection write already in flight must settle before choosing its destination.
      await saving.catch(() => undefined);
      const value = await read();
      if (
        value.mode !== 'openai-api' ||
        value.model !== expectedModel ||
        !validVoiceModel('openai-api', expectedModel) ||
        value.apiKey.length === 0 ||
        value.apiKey.length > 4096 ||
        !/^[\x21-\x7e]+$/.test(value.apiKey)
      ) {
        throw new Error('Unavailable');
      }
      return { model: value.model, apiKey: value.apiKey };
    } catch {
      // Native storage errors must not surface credential payloads to the call UI.
      throw new Error('Realtime credentials unavailable or selection changed');
    }
  },
  save(value: {
    mode: VoiceMode;
    model: string;
    replacementKey?: string;
    removeKey?: boolean;
  }): Promise<void> {
    const operation = saving
      .catch(() => undefined)
      .then(async () => {
        const prior = await read();
        const model = value.model.trim();
        const apiKey = value.removeKey
          ? ''
          : value.replacementKey?.trim() || prior.apiKey;
        if (
          !validVoiceModel(value.mode, model) ||
          model.length > 200 ||
          apiKey.length > 4096 ||
          /[\r\n]/.test(model + apiKey) ||
          (value.mode === 'openai-api' && (!model || !apiKey))
        ) {
          throw new Error('Voice configuration is incomplete');
        }
        const saved = await setGenericPassword(
          'voice-settings',
          JSON.stringify({
            mode: value.mode,
            model,
            apiKey,
          }),
          { service, accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
        );
        if (!saved) throw new Error('Voice settings could not be saved');
        listeners.forEach(listener => listener());
      });
    saving = operation;
    return operation;
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** The local adapter must never consume an API model selection or authorize external audio. */
export async function requireLocalVoiceProcessing(): Promise<boolean> {
  return (await voiceSettingsStore.load()).mode === 'local';
}
