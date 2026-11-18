import {
  apiCredentialMutation,
  beginVoiceSettingsMutation,
  createVoiceConsentIdentity,
} from './voiceConsentIdentity';
import { createConsentGeneration } from '../agent/execution/consentGeneration';
import { discoverApiModels } from './voiceApiModelCatalog';
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
  credentialEpoch?: string;
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
    typeof parsed.apiKey !== 'string' ||
    (parsed.credentialEpoch !== undefined &&
      !/^[a-f0-9]{64}$/.test(parsed.credentialEpoch))
  ) {
    throw new Error('Voice settings unavailable');
  }
  return parsed;
}

/** Keep credentials out of React state and saved-settings readbacks. No network validation occurs. */
export const voiceSettingsStore = {
  ...createVoiceConsentIdentity({
    read,
    enqueue(work) {
      const next = saving.catch(() => undefined).then(work);
      saving = next;
      return next;
    },
    async write(value) {
      const saved = await setGenericPassword(
        'voice-settings',
        JSON.stringify(value),
        { service, accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
      );
      if (!saved) throw new Error('Credential identity could not be saved');
    },
  }),
  async load(): Promise<VoiceSettings> {
    const value = await read();
    return {
      mode: value.mode,
      model: value.model,
      hasApiKey: Boolean(value.apiKey),
    };
  },
  /** Exact selected Realtime credentials only; keep this secret out of UI/logs/storage. */
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
    const finishMutation = beginVoiceSettingsMutation(
      Boolean(value.removeKey || value.replacementKey?.trim()),
    );
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
            credentialEpoch: value.removeKey
              ? undefined
              : value.replacementKey?.trim()
                ? createConsentGeneration()
                : prior.credentialEpoch,
          }),
          { service, accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
        );
        if (!saved) throw new Error('Voice settings could not be saved');
        if (value.removeKey || value.replacementKey?.trim())
          accountRevision += 1;
        listeners.forEach(listener => listener());
      });
    saving = operation.finally(finishMutation);
    return saving;
  },
  /** The same device-only item owns credentials and epochs; neither leaves this storage boundary. */
  setAccountKey(key: string): Promise<void> {
    const finishMutation = apiCredentialMutation.begin();
    const operation = saving
      .catch(() => undefined)
      .then(async () => {
        const prior = await read();
        const apiKey = key.trim();
        if (apiKey.length > 4096 || (apiKey && !/^[\x21-\x7e]+$/.test(apiKey)))
          throw new Error('Invalid API credential');
        const saved = await setGenericPassword(
          'voice-settings',
          JSON.stringify({
            ...prior,
            apiKey,
            credentialEpoch: apiKey ? createConsentGeneration() : undefined,
          }),
          { service, accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
        );
        if (!saved) throw new Error('API account could not be saved');
        accountRevision += 1;
        listeners.forEach(listener => listener());
      });
    saving = operation.finally(finishMutation);
    return saving;
  },
  async accountStatus(): Promise<{ connected: boolean; revision: number }> {
    await saving.catch(() => undefined);
    const revision = accountRevision;
    const value = await read();
    if (revision !== accountRevision) return voiceSettingsStore.accountStatus();
    return { connected: Boolean(value.apiKey), revision };
  },
  /** Explicit catalog refresh only; account changes invalidate the returned models. */
  async discoverModels(
    signal: AbortSignal,
  ): Promise<{ revision: number; ids: string[] }> {
    return discoverApiModels(
      signal,
      async () => {
        await saving.catch(() => undefined);
        const revision = accountRevision;
        const value = await read();
        return { revision, apiKey: value.apiKey };
      },
      async revision => {
        await saving.catch(() => undefined);
        return revision === accountRevision;
      },
    );
  },
  /** Calendar selection is independent; discard secrets after use and fence account changes. */
  async classificationCredentials(
    expectedRevision: number,
    signal?: AbortSignal,
  ): Promise<string> {
    try {
      await saving.catch(() => undefined);
      if (signal?.aborted || expectedRevision !== accountRevision)
        throw new Error('Unavailable');
      const value = await read();
      if (
        signal?.aborted ||
        expectedRevision !== accountRevision ||
        !value.apiKey ||
        value.apiKey.length > 4096 ||
        !/^[\x21-\x7e]+$/.test(value.apiKey)
      )
        throw new Error('Unavailable');
      return value.apiKey;
    } catch {
      throw new Error(
        'Calendar API credentials unavailable or account changed',
      );
    }
  },
  accountRevisionMatches(revision: number): boolean {
    return revision === accountRevision;
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
