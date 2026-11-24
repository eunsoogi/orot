import { readSettingsVoicePairSelection } from '../storage/settingsVoicePairSelection';
import { currentVoicePairAuthorities } from './voicePairAuthorities';
import { createVoiceSettingsStore } from './createVoiceSettingsStore';
import {
  apiCredentialMutation,
  beginVoiceSettingsMutation,
} from './voiceConsentIdentity';
export type { VoiceMode, VoiceSettings } from './voiceSettingsTypes';

/** The application retains its existing device-only credential service and live owners. */
export const voiceSettingsStore = createVoiceSettingsStore({
  service: 'com.orot.mobile.voice-settings.v1',
  beginSettingsMutation: beginVoiceSettingsMutation,
  beginCredentialMutation: () => apiCredentialMutation.begin(),
  readVoicePairActive: currentVoicePairAuthorities,
  readVoicePairSelection: () =>
    import('../storage/secureDatabase')
      .then(module => module.openLocalAgentMemoryDatabase())
      .then(readSettingsVoicePairSelection),
});

/** The local adapter must never consume an API model selection or authorize external audio. */
export async function requireLocalVoiceProcessing(): Promise<boolean> {
  return (await voiceSettingsStore.load()).mode === 'local';
}
