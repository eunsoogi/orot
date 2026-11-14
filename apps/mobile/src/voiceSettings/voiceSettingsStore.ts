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
let accountRevision = 0;
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
    expectedAccountRevision?: number;
  }): Promise<void> {
    const operation = saving
      .catch(() => undefined)
      .then(async () => {
        if (
          value.expectedAccountRevision !== undefined &&
          value.expectedAccountRevision !== accountRevision
        )
          throw new Error('API account changed');
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
        if (value.removeKey || value.replacementKey?.trim())
          accountRevision += 1;
        listeners.forEach(listener => listener());
      });
    saving = operation;
    return operation;
  },
  /** The existing device-only item remains the sole credential authority. Moving
   * its management UI requires no secret copy, destructive migration or fallback.
   */
  setAccountKey(key: string): Promise<void> {
    const operation = saving
      .catch(() => undefined)
      .then(async () => {
        const prior = await read();
        const apiKey = key.trim();
        if (apiKey.length > 4096 || (apiKey && !/^[\x21-\x7e]+$/.test(apiKey)))
          throw new Error('Invalid API credential');
        const saved = await setGenericPassword(
          'voice-settings',
          JSON.stringify({ ...prior, apiKey }),
          { service, accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
        );
        if (!saved) throw new Error('API account could not be saved');
        accountRevision += 1;
        listeners.forEach(listener => listener());
      });
    saving = operation;
    return operation;
  },
  async accountStatus() {
    await saving.catch(() => undefined);
    const value = await read();
    return { connected: Boolean(value.apiKey), revision: accountRevision };
  },
  /** Only explicit catalog refresh uses this boundary, never audio or inference.
   * Provider payloads/errors are not returned; an account change invalidates results.
   */
  async discoverModels(
    signal: AbortSignal,
  ): Promise<{ revision: number; ids: string[] }> {
    await saving.catch(() => undefined);
    const revision = accountRevision;
    const value = await read();
    if (!value.apiKey) throw new Error('no-account');
    if (value.apiKey.length > 4096 || !/^[\x21-\x7e]+$/.test(value.apiKey))
      throw new Error('access');
    let response: Response;
    try {
      response = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: `Bearer ${value.apiKey}` },
        signal,
        redirect: 'error',
      });
    } catch {
      throw new Error('network');
    }
    if (response.status === 401 || response.status === 403)
      throw new Error('access');
    if (response.status === 429) throw new Error('rate-limit');
    if (!response.ok) throw new Error('server');
    let payload: { data?: { id?: unknown }[] };
    try {
      payload = await response.json();
    } catch {
      throw new Error('invalid');
    }
    if (!Array.isArray(payload?.data)) throw new Error('invalid');
    await saving.catch(() => undefined);
    if (revision !== accountRevision) throw new Error('account-changed');
    return {
      revision,
      ids: [
        ...new Set(
          payload.data.flatMap(item =>
            typeof item?.id === 'string' &&
            /^[a-zA-Z0-9._-]{1,200}$/.test(item.id)
              ? [item.id]
              : [],
          ),
        ),
      ],
    };
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
