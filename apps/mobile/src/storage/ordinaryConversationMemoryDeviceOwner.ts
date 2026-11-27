import type { SqlDatabase } from '@orot/storage';
import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import { createConsentAuthority } from '../agent/execution/consentAuthority';
import { createConsentGeneration } from '../agent/execution/consentGeneration';
import { createOrdinaryConversationMemoryOwner } from './ordinaryConversationMemoryAuthority';
import { openLocalAgentMemoryDatabase } from './secureDatabase';

import type { LocalConversationMemoryScope } from './ordinaryConversationMemoryEnrollment';

type Owner = ReturnType<typeof createOrdinaryConversationMemoryOwner>;
type SettingsStatus = 'on' | 'off' | 'unavailable';

/** Each disclosed local policy has an independent device witness and revision. */
function createDeviceMemoryOwner(
  scope: LocalConversationMemoryScope,
  service: string,
  account: string,
) {
  async function readDeviceAuthority(): Promise<unknown> {
    const value = await getGenericPassword({ service });
    if (value === false) return null;
    if (value.username !== account) return { invalid: true };
    try {
      const parsed: unknown = JSON.parse(value.password);
      // Only native item-not-found is absence; a stored JSON null is malformed.
      return parsed ?? { invalid: true };
    } catch {
      return { invalid: true };
    }
  }

  const authority = createConsentAuthority(
    {
      read: readDeviceAuthority,
      async write(value) {
        // This is a permission generation only, never a credential or note.
        const saved = await setGenericPassword(account, JSON.stringify(value), {
          service,
          accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
        if (saved === false)
          throw new Error('Local memory permission could not be saved.');
      },
    },
    createConsentGeneration,
  );
  const owners = new WeakMap<
    SqlDatabase,
    ReturnType<typeof createOrdinaryConversationMemoryOwner>
  >();

  /** Reuse the existing protected connection without caching permission decisions.
   * All connections share the same device authority, so revocation fences them all. */
  async function openOwner() {
    const database = await openLocalAgentMemoryDatabase();
    const previous = owners.get(database);
    if (previous) return previous;
    const owner = createOrdinaryConversationMemoryOwner(
      database,
      authority,
      scope,
    );
    owners.set(database, owner);
    return owner;
  }

  let mutationRevision = 0;
  authority.subscribe(() => {
    mutationRevision++;
  });

  /** Call at fresh live composer admission, before waiting for the DB owner.
   * A grant created while that lookup is pending cannot authorize the older send. */
  async function captureAdmission() {
    const started = mutationRevision;
    const owner = await openOwner();
    if (started !== mutationRevision) return;
    const captured = await owner.capture();
    const isCurrent = () =>
      started === mutationRevision && captured?.isCurrent() === true;
    return captured && isCurrent() ? { ...captured, isCurrent } : undefined;
  }

  /** Settings must not present an unreadable/mismatched owner as confirmed OFF.
   * The only positive ON evidence is the same capture witness used by the writer. */
  async function readSettings(owner: Owner): Promise<SettingsStatus> {
    const started = mutationRevision;
    const current = await owner.capture();
    if (started !== mutationRevision) return 'unavailable';
    if (current?.isCurrent()) return 'on';
    const off = await owner.settingsEnrollmentIsOff();
    const value = await readDeviceAuthority();
    if (!off || started !== mutationRevision) return 'unavailable';
    if (value === null) return 'off';
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return 'unavailable';
    const row = value as Record<string, unknown>;
    return Object.keys(row).sort().join(',') === 'generation,status,version' &&
      row.version === 1 &&
      typeof row.generation === 'string' &&
      /^[a-f0-9]{64}$/.test(row.generation) &&
      (row.status === 'revoked' || row.status === 'suspended')
      ? 'off'
      : 'unavailable';
  }

  return { openOwner, captureAdmission, readSettings };
}

// Keep the previously disclosed preference grant and its existing Keychain
// identity unchanged. It cannot stand in for the separate routine opt-in.
const preferences = createDeviceMemoryOwner(
  'reply-preferences',
  'com.orot.mobile.ordinary-conversation-memory-authority.v1',
  'ordinary-conversation-memory-authority',
);
export const openOrdinaryConversationMemoryOwner = preferences.openOwner;
export const captureOrdinaryConversationMemoryAdmission =
  preferences.captureAdmission;
export const readOrdinaryConversationMemorySettings = preferences.readSettings;

export const authoredRoutineMemoryDeviceOwner = createDeviceMemoryOwner(
  'authored-routine',
  'com.orot.mobile.authored-routine-memory-authority.v1',
  'authored-routine-memory-authority',
);

// General authored notes require a distinct disclosure and never inherit a narrower grant.
export const authoredNoteMemoryDeviceOwner = createDeviceMemoryOwner(
  'authored-note',
  'com.orot.mobile.authored-note-memory-authority.v1',
  'authored-note-memory-authority',
);
