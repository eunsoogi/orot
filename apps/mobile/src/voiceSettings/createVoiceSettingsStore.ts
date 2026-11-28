import { createVoiceConsentIdentity } from './voiceConsentIdentity';
import { createConsentGeneration } from '../agent/execution/consentGeneration';
import { createVoiceCatalogDisplayStore } from './voiceCatalogDisplayStore';
import { validVoiceModel } from './voiceModels';
import {
  legacyVoiceCredentials,
  liveVoiceCredentials,
  readVoiceCallCredentials,
} from './readVoiceCallCredentials';
import { voiceSettingsKeychainRecord } from './voiceSettingsKeychainRecord';
import { createVoicePairSettingsAdapter } from './createVoicePairSettingsAdapter';
import type { SettingsVoicePairSelection } from '../storage/settingsVoicePairSelection';

import type { VoiceMode, VoiceSettings } from './voiceSettingsTypes';

/** Connection-local credential owner. Production supplies its unchanged service and
 * mutation owners; synthetic native tests supply an admitted UUID service only. */
export function createVoiceSettingsStore(input: {
  service: string;
  beginSettingsMutation(changesCredential: boolean): () => void;
  beginCredentialMutation(): () => void;
  readVoicePairSelection?: () => Promise<SettingsVoicePairSelection | null>;
  readVoicePairActive?: (
    pair: SettingsVoicePairSelection,
  ) => Promise<(() => boolean) | null>;
}) {
  const { service } = input;
  let accountRevision = 0;
  const listeners = new Set<() => void>();
  let saving: Promise<void> = Promise.resolve();
  const { read, write } = voiceSettingsKeychainRecord(service);
  const enqueue = (work: () => Promise<void>) => {
    const next = saving.catch(() => undefined).then(work);
    saving = next;
    return next;
  };

  const paired = createVoicePairSettingsAdapter({
    read,
    write,
    enqueue,
    settle: () => saving.catch(() => undefined),
    readSelection: input.readVoicePairSelection,
    readPairActive: input.readVoicePairActive,
    currentRevision: () => accountRevision,
    beginMutation: () => input.beginSettingsMutation(false),
  });

  const readAfterSettings = async () => {
    await saving.catch(() => undefined);
    return paired.readEffective();
  };

  async function loadVoicePairPresentation() {
    const value = await paired.readDisplayed();
    const settings: VoiceSettings = {
      mode: value.mode,
      model: value.model,
      hasApiKey: Boolean(value.apiKey),
      ...(value.pairAwaitingActivation ? { pairAwaitingActivation: true } : {}),
    };
    return { settings, pairPresentationCurrent: value.pairPresentationCurrent };
  }
  /** Keep credentials out of React state and saved-settings readbacks. No network validation occurs. */
  const store = {
    ...createVoiceConsentIdentity({ read, enqueue, write }),
    stageVoicePair: paired.stageVoicePair,
    loadCommittedVoicePair: paired.loadCommittedVoicePair,
    legacyVoiceRollbackEpoch: paired.legacyVoiceRollbackEpoch,
    activateVoicePair: paired.activateVoicePair,
    captureVoicePairPublication: paired.captureVoicePairPublication,
    loadVoicePairPresentation,
    async load(): Promise<VoiceSettings> {
      const { settings, pairPresentationCurrent } =
        await loadVoicePairPresentation();
      return pairPresentationCurrent?.() === false
        ? { ...settings, pairAwaitingActivation: true }
        : settings;
    },
    realtimeCredentials(expectedModel: string) {
      return readVoiceCallCredentials(
        readAfterSettings,
        legacyVoiceCredentials(expectedModel),
        'Realtime',
      );
    },
    liveCredentials() {
      return readVoiceCallCredentials(
        readAfterSettings,
        liveVoiceCredentials,
        'Live',
      );
    },
    save(value: {
      mode: VoiceMode;
      model: string;
      replacementKey?: string;
      removeKey?: boolean;
      expectedAccountRevision?: number;
    }): Promise<void> {
      const finishMutation = input.beginSettingsMutation(
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
          await write({
            mode: value.mode,
            model,
            apiKey,
            credentialEpoch: value.removeKey
              ? undefined
              : value.replacementKey?.trim()
                ? createConsentGeneration()
                : prior.credentialEpoch,
          });
          if (value.removeKey || value.replacementKey?.trim())
            accountRevision += 1;
          listeners.forEach(listener => listener());
        });
      saving = operation.finally(finishMutation);
      return saving;
    },
    /** The same device-only item owns credentials and epochs; neither leaves this storage boundary. */
    setAccountKey(key: string): Promise<void> {
      const finishMutation = input.beginCredentialMutation();
      const operation = saving
        .catch(() => undefined)
        .then(async () => {
          const prior = await read();
          const apiKey = key.trim();
          if (
            apiKey.length > 4096 ||
            (apiKey && !/^[\x21-\x7e]+$/.test(apiKey))
          )
            throw new Error('Invalid API credential');
          await write({
            ...prior,
            apiKey,
            credentialEpoch: apiKey ? createConsentGeneration() : undefined,
          });
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
      if (revision !== accountRevision) return store.accountStatus();
      return { connected: Boolean(value.apiKey), revision };
    },
    ...createVoiceCatalogDisplayStore({
      service,
      revision: () => accountRevision,
      settle: () => saving.catch(() => undefined),
      read,
      enqueue,
    }),
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

  return store;
}
