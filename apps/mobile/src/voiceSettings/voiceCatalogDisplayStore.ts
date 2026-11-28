import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import { discoverApiModels } from './voiceApiModelCatalog';
import { liveModel } from './liveVoicePreferences';
import { isLiveResponsesBackend } from './liveResponsesSettingsIdentity';
import type { StoredVoiceSettings } from './voiceSettingsTypes';

export const supportedVoiceModelIds = (ids: readonly unknown[]) => [
  ...new Set(
    ids.filter(
      (id): id is string => id === liveModel || isLiveResponsesBackend(id),
    ),
  ),
];

const cacheAccount = 'voice-model-catalog-display';

/** Durable hints only. Never return a key/epoch or treat remembered rows as a
 * fresh discovery. Unversioned legacy credentials cannot read or write cache. */
export function createVoiceCatalogDisplayStore(input: {
  service: string;
  revision(): number;
  settle(): Promise<unknown>;
  read(): Promise<StoredVoiceSettings>;
  enqueue(work: () => Promise<void>): Promise<void>;
}) {
  const service = input.service + '.model-catalog-display.v1';
  const snapshot = async () => {
    await input.settle();
    const revision = input.revision();
    const record = await input.read();
    return { revision, apiKey: record.apiKey, epoch: record.credentialEpoch };
  };
  async function discover(signal: AbortSignal, persist: boolean) {
    let observed: Awaited<ReturnType<typeof snapshot>> | undefined;
    const result = await discoverApiModels(
      signal,
      async () => (observed = await snapshot()),
      async revision => {
        await input.settle();
        return !signal.aborted && input.revision() === revision;
      },
    );
    if (persist && observed?.epoch) {
      const captured = observed;
      // Order cache publication with existing account writes. Failure to store
      // presentation data never invalidates otherwise fresh network discovery.
      await input
        .enqueue(async () => {
          if (signal.aborted || input.revision() !== result.revision) return;
          const current = await input.read();
          if (
            signal.aborted ||
            captured.apiKey !== current.apiKey ||
            captured.epoch !== current.credentialEpoch
          )
            return;
          await setGenericPassword(
            cacheAccount,
            JSON.stringify({
              version: 1,
              epoch: captured.epoch,
              ids: supportedVoiceModelIds(result.ids),
            }),
            {
              service,
              accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            },
          );
        })
        .catch(() => {});
    }
    await input.settle();
    if (signal.aborted || input.revision() !== result.revision)
      throw new Error('account-changed');
    return result;
  }
  return {
    async loadDisplayModelCatalog(expected: number): Promise<string[]> {
      const first = await snapshot();
      if (!first.apiKey || !first.epoch || first.revision !== expected)
        return [];
      const cache = await getGenericPassword({ service });
      if (
        !cache ||
        cache.username !== cacheAccount ||
        cache.password.length > 4096
      )
        return [];
      const current = await snapshot();
      if (
        current.revision !== expected ||
        input.revision() !== expected ||
        current.apiKey !== first.apiKey ||
        current.epoch !== first.epoch
      )
        return [];
      const record: unknown = JSON.parse(cache.password);
      if (!record || typeof record !== 'object') return [];
      const { version, epoch, ids } = record as {
        version?: unknown;
        epoch?: unknown;
        ids?: unknown;
      };
      return version === 1 && epoch === current.epoch && Array.isArray(ids)
        ? supportedVoiceModelIds(ids)
        : [];
    },
    discoverModels: (signal: AbortSignal) => discover(signal, false),
    refreshDisplayModels: (signal: AbortSignal) => discover(signal, true),
  };
}
