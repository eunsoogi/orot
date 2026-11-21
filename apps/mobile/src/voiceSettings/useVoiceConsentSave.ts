import { useMemo } from 'react';
import { useModelConsentSave } from '../agent/execution/useModelConsentSave';
import {
  liveVoiceModelId,
  liveVoiceProviderId,
} from '../agent/execution/liveVoiceSettingsIdentity';
import type { VoiceMode } from './voiceSettingsStore';
import { useModelSettingsServices } from '../agent/execution/ModelSettingsServices';

/** Adapt the existing voice selection writer, never its credential or audio transport. */
export function useVoiceConsentSave(accountRevision: number | null) {
  const { voice: voiceSettingsStore } = useModelSettingsServices();
  const store = useMemo(
    () => ({
      async load() {
        const value = await voiceSettingsStore.load();
        return {
          providerId:
            value.mode === 'openai-api'
              ? value.model === liveVoiceModelId
                ? liveVoiceProviderId
                : 'openai-realtime'
              : 'apple-local-voice',
          modelId: value.model,
        };
      },
      async save(value: { providerId: string; modelId: string }) {
        if (
          ![liveVoiceProviderId, 'apple-local-voice'].includes(
            value.providerId,
          ) ||
          (value.providerId === liveVoiceProviderId &&
            value.modelId !== liveVoiceModelId)
        )
          throw new Error('Unknown voice destination');
        const mode =
          value.providerId === liveVoiceProviderId ? 'openai-api' : 'local';
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
    [accountRevision, voiceSettingsStore],
  );
  const save = useModelConsentSave('voice', store);
  return (mode: VoiceMode, model: string, isCurrentDraft: () => boolean) =>
    save(
      {
        provider: {
          id: mode === 'openai-api' ? liveVoiceProviderId : 'apple-local-voice',
        },
        modelId: model,
        privacyBoundary:
          mode === 'openai-api' ? 'selected-context-remote' : 'on-device',
      },
      undefined,
      isCurrentDraft,
    );
}
