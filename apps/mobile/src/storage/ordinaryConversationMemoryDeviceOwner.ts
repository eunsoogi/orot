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

const service = 'com.orot.mobile.ordinary-conversation-memory-authority.v1';
const account = 'ordinary-conversation-memory-authority';

async function readDeviceAuthority(): Promise<unknown> {
  const value = await getGenericPassword({ service });
  if (value === false) return null;
  if (value.username !== account) return { invalid: true };
  try {
    return JSON.parse(value.password) as unknown;
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
export async function openOrdinaryConversationMemoryOwner() {
  const database = await openLocalAgentMemoryDatabase();
  const previous = owners.get(database);
  if (previous) return previous;
  const owner = createOrdinaryConversationMemoryOwner(database, authority);
  owners.set(database, owner);
  return owner;
}

let mutationRevision = 0;
authority.subscribe(() => {
  mutationRevision++;
});

/** Call at fresh live composer admission, before waiting for the DB owner.
 * A grant created while that lookup is pending cannot authorize the older send. */
export async function captureOrdinaryConversationMemoryAdmission() {
  const started = mutationRevision;
  const owner = await openOrdinaryConversationMemoryOwner();
  if (started !== mutationRevision) return;
  const captured = await owner.capture();
  const isCurrent = () =>
    started === mutationRevision && captured?.isCurrent() === true;
  return captured && isCurrent() ? { ...captured, isCurrent } : undefined;
}

type Owner = Awaited<ReturnType<typeof openOrdinaryConversationMemoryOwner>>;
type SettingsStatus = 'on' | 'off' | 'unavailable';

/** Settings must not present an unreadable/mismatched owner as confirmed OFF.
 * The only positive ON evidence is the same capture witness used by the writer. */
export async function readOrdinaryConversationMemorySettings(
  owner: Owner,
): Promise<SettingsStatus> {
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
