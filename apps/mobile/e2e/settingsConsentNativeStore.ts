import { IOS_LIBRARY_PATH, isSQLCipher, open } from '@op-engineering/op-sqlite';
import {
  ACCESSIBLE,
  getGenericPassword,
  resetGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import type { ConsentAuthorityPersistence } from '../src/agent/execution/consentAuthority';
import type { ProviderSelectionStore } from '../src/providers/selection/types';
import type { SettingsConsentSlot } from '../src/storage/settingsConsentStorage';

export const consentFixtureSlots = [
  'conversation',
  'calendar',
  'voice',
] as const;

/** Exact UUID namespaces are the only resources this fixture can open or remove.
 * No application credential service, model catalog or normal database is consulted. */
export function consentFixtureIdentity(value: unknown) {
  if (
    typeof value !== 'string' ||
    !/^test-settings-consent-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
      value,
    )
  )
    throw new Error('Settings consent fixture requires an isolated UUID');
  return value.toLowerCase();
}

export async function openSettingsConsentNativeStore(
  identifier: unknown,
  create: boolean,
) {
  const name = consentFixtureIdentity(identifier);
  if (!isSQLCipher())
    throw new Error('Settings consent fixture requires SQLCipher');
  const prefix = `com.orot.test.${name}`;
  const service = (suffix: string) => `${prefix}.${suffix}`;
  const write = async (suffix: string, value: unknown) => {
    const result = await setGenericPassword(
      'synthetic-settings-consent',
      JSON.stringify(value),
      {
        service: service(suffix),
        accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    );
    if (!result) throw new Error('Synthetic protected write failed');
  };
  const read = async (suffix: string): Promise<unknown> => {
    const row = await getGenericPassword({ service: service(suffix) });
    return row ? (JSON.parse(row.password) as unknown) : null;
  };
  let key = await read('database-key');
  if (create) {
    if (key !== null) throw new Error('Synthetic namespace already exists');
    const random = new Uint8Array(32);
    globalThis.crypto.getRandomValues(random);
    key = Array.from(random, byte => byte.toString(16).padStart(2, '0')).join(
      '',
    );
    await write('database-key', key);
  }
  if (typeof key !== 'string' || !/^[0-9a-f]{64}$/.test(key))
    throw new Error('Synthetic encryption key unavailable');
  const database = open({
    name: `${name}.db`,
    location: IOS_LIBRARY_PATH,
    encryptionKey: key,
  });
  const slotName = (slot: SettingsConsentSlot) => {
    if (!consentFixtureSlots.includes(slot))
      throw new Error('Unknown synthetic slot');
    return slot;
  };
  return {
    database,
    authority(slot: SettingsConsentSlot): ConsentAuthorityPersistence {
      const suffix = `authority-${slotName(slot)}`;
      return { read: () => read(suffix), write: value => write(suffix, value) };
    },
    selection(slot: SettingsConsentSlot): ProviderSelectionStore {
      const suffix = `selection-${slotName(slot)}`;
      return {
        async load() {
          const value = await read(suffix);
          if (value === null) return null;
          if (
            !value ||
            typeof value !== 'object' ||
            !('providerId' in value) ||
            !('modelId' in value) ||
            typeof value.providerId !== 'string' ||
            typeof value.modelId !== 'string'
          )
            throw new Error('Synthetic selection malformed');
          return { providerId: value.providerId, modelId: value.modelId };
        },
        save: value => write(suffix, value),
        async clear() {
          await resetGenericPassword({ service: service(suffix) });
        },
      };
    },
    close() {
      database.close();
    },
    async remove() {
      database.delete();
      for (const slot of consentFixtureSlots) {
        await resetGenericPassword({ service: service(`authority-${slot}`) });
        await resetGenericPassword({ service: service(`selection-${slot}`) });
      }
      await resetGenericPassword({ service: service('database-key') });
    },
  };
}
