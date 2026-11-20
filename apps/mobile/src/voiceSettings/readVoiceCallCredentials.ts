import { liveModel } from './liveVoicePreferences';
import { validVoiceModel } from './voiceModels';
import type { StoredVoiceSettings } from './voiceSettingsTypes';

/** Keep the credential at the app-owned call boundary; no model/recipient fallback. */
export async function readVoiceCallCredentials<T>(
  read: () => Promise<StoredVoiceSettings>,
  select: (value: StoredVoiceSettings) => T | undefined,
  runtime: 'Realtime' | 'Live',
): Promise<T> {
  try {
    const value = await read();
    if (
      value.mode === 'openai-api' &&
      value.apiKey.length <= 4096 &&
      /^[\x21-\x7e]+$/.test(value.apiKey)
    ) {
      const selected = select(value);
      if (selected) return selected;
    }
  } catch {
    // Backend and Keychain errors can contain credentials.
  }
  throw new Error(`${runtime} credentials unavailable or selection changed`);
}

export function legacyVoiceCredentials(expectedModel: string) {
  return (value: StoredVoiceSettings) =>
    expectedModel !== liveModel &&
    value.model === expectedModel &&
    validVoiceModel('openai-api', expectedModel)
      ? { model: value.model, apiKey: value.apiKey }
      : undefined;
}

export function liveVoiceCredentials(value: StoredVoiceSettings) {
  return value.model === liveModel && value.credentialEpoch
    ? {
        model: liveModel,
        apiKey: value.apiKey,
        credentialEpoch: value.credentialEpoch,
      }
    : undefined;
}
