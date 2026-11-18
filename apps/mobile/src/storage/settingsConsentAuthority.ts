import { createConsentGeneration } from '../agent/execution/consentGeneration';
import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import { createConsentAuthority } from '../agent/execution/consentAuthority';
import type { SettingsConsentSlot } from './settingsConsentStorage';

const authorities = new Map<
  SettingsConsentSlot,
  ReturnType<typeof createConsentAuthority>
>();

/** One captured writer/queue per fixed settings slot. Do not create independent
 * owners for the same Keychain item: Keychain provides no compare-and-set operation.
 * Tombstones remain after SQLCipher cleanup so a failed cleanup cannot restore consent.
 * This item contains only random generations/status, never account secrets or payloads. */
export function settingsConsentAuthority(slot: SettingsConsentSlot) {
  if (!['conversation', 'calendar', 'voice'].includes(slot))
    throw new Error('Invalid consent slot');
  const existing = authorities.get(slot);
  if (existing) return existing;
  const service = `com.orot.mobile.settings-consent-authority.v1.${slot}`;
  const owner = createConsentAuthority(
    {
      async read() {
        const value = await getGenericPassword({ service });
        if (!value) return null;
        try {
          return JSON.parse(value.password) as unknown;
        } catch {
          return null;
        }
      },
      async write(value) {
        const stored = await setGenericPassword(
          'settings-consent-authority',
          JSON.stringify(value),
          { service, accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY },
        );
        if (!stored) throw new Error('Permission state could not be saved');
      },
    },
    createConsentGeneration,
  );
  authorities.set(slot, owner);
  return owner;
}
