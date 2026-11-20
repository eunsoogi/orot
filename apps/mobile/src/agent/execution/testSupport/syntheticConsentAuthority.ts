import { createConsentAuthority } from '../consentAuthority';
import type { ConsentAuthorityState } from '../consentAuthority';
import type { SettingsConsentSlot } from '../../../storage/settingsConsentStorage';

// Navigation tests retain the real authority state machine but replace native
// Keychain/entropy with per-test-file synthetic storage. Not restart evidence.
const owners = new Map<
  SettingsConsentSlot,
  ReturnType<typeof createConsentAuthority>
>();
let sequence = 0;
export function settingsConsentAuthority(slot: SettingsConsentSlot) {
  const existing = owners.get(slot);
  if (existing) return existing;
  let stored: ConsentAuthorityState | null = null;
  const owner = createConsentAuthority(
    {
      read: async () => stored,
      write: async value => {
        stored = { ...value };
      },
    },
    () => (++sequence).toString(16).padStart(64, '0'),
  );
  owners.set(slot, owner);
  return owner;
}
