import { readLivePreferences } from './liveVoicePreferences';
import type { LiveVoicePreferenceStore } from './liveVoicePreferenceStore';
import { liveVoicePreferencesKeychain } from './liveVoicePreferencesKeychain';
import { voiceSettingsStore } from './voiceSettingsStore';

export function openAiVoicePreferencesDraftReader(
  revision: number,
): Pick<LiveVoicePreferenceStore, 'load'> {
  const owns = () => voiceSettingsStore.accountRevisionMatches(revision);
  return {
    async load() {
      const account = await voiceSettingsStore.accountStatus();
      if (!account.connected || account.revision !== revision || !owns())
        return { kind: 'unavailable' } as const;
      // An old pair may still be displayed after changing an account. Never
      // copy its preferences into a new account's unstored draft.
      const pair = await voiceSettingsStore
        .loadCommittedVoicePair()
        .catch(() => null);
      if (!owns()) return { kind: 'unavailable' } as const;
      if (pair)
        return {
          kind: 'ready',
          owner: pair.pair.credentialEpoch,
          preferences: pair.preferences,
        } as const;
      const legacy = await liveVoicePreferencesKeychain.load();
      if (!owns()) return { kind: 'unavailable' } as const;
      if (legacy.kind === 'ready') return legacy;
      if (await voiceSettingsStore.consentAccountEpoch(false))
        return { kind: 'unavailable' } as const;
      // Legacy linked credentials need no write to show a neutral form draft.
      // This is not a credential epoch and cannot be used by the save owner.
      const defaults = readLivePreferences(undefined);
      return owns() && defaults.kind === 'ready'
        ? ({
            kind: 'ready',
            owner: 'unsaved-voice-preferences',
            preferences: defaults.value,
          } as const)
        : ({ kind: 'unavailable' } as const);
    },
  };
}
