import { useMemo } from 'react';
import { useModelConsentSave } from '../agent/execution/useModelConsentSave';
import { voiceSettingsStore, type VoiceMode } from './voiceSettingsStore';

/** Adapt the existing voice selection writer, never its credential or audio transport. */
export function useVoiceConsentSave(accountRevision: number | null) {
  const store = useMemo(
    () => ({
      async load() {
        const value = await voiceSettingsStore.load();
        return {
          providerId:
            value.mode === 'openai-api'
              ? 'openai-realtime'
              : 'apple-local-voice',
          modelId: value.model,
        };
      },
      async save(value: { providerId: string; modelId: string }) {
        if (
          !['openai-realtime', 'apple-local-voice'].includes(value.providerId)
        )
          throw new Error('Unknown voice destination');
        const mode =
          value.providerId === 'openai-realtime' ? 'openai-api' : 'local';
        await voiceSettingsStore.save({
          mode,
          model: value.modelId,
          ...(mode === 'openai-api' && accountRevision !== null
            ? { expectedAccountRevision: accountRevision }
            : {}),
        });
      },
      async clear() {
        throw new Error('Voice selection cannot be cleared implicitly');
      },
    }),
    [accountRevision],
  );
  const save = useModelConsentSave('voice', store);
  return (mode: VoiceMode, model: string) =>
    save({
      provider: {
        id: mode === 'openai-api' ? 'openai-realtime' : 'apple-local-voice',
      },
      modelId: model,
      privacyBoundary:
        mode === 'openai-api' ? 'selected-context-remote' : 'on-device',
    });
}
