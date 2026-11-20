import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import { createLiveVoicePreferenceStore } from './liveVoicePreferenceStore';
import { voiceSettingsStore } from './voiceSettingsStore';

const service = 'com.orot.mobile.live-voice-preferences.v1';

/** The existing device-only API credential owns the separate, nonsecret voice preferences. */
export const liveVoicePreferencesKeychain = createLiveVoicePreferenceStore({
  currentOwner: () => voiceSettingsStore.consentAccountEpoch(false),
  async read() {
    const record = await getGenericPassword({ service });
    return record ? (JSON.parse(record.password) as unknown) : undefined;
  },
  async write(record) {
    const result = await setGenericPassword(
      'live-voice-preferences',
      JSON.stringify(record),
      {
        service,
        accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    );
    if (!result) throw new Error('Live preferences could not be saved');
  },
});

/** Candidate startup obtains one immutable snapshot for this call. Distinct Live
 * settings consent/broker must validate ownership before carrying credentials. */
export async function loadLiveCallSettings() {
  const credentials = await voiceSettingsStore.liveCredentials();
  const result = await liveVoicePreferencesKeychain.load();
  const current = await voiceSettingsStore.liveCredentials();
  if (
    result.kind !== 'ready' ||
    credentials.credentialEpoch !== result.owner ||
    current.credentialEpoch !== credentials.credentialEpoch ||
    current.apiKey !== credentials.apiKey
  )
    throw new Error('Live preferences unavailable or account changed');
  return Object.freeze({ ...credentials, preferences: result.preferences });
}
