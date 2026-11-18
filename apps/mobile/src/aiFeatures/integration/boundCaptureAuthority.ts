import { ownsEvidenceRegistryReaders } from './evidenceRegistryReadOwner';
import { ownsConversationStrictReaders } from '../../storage/conversationStrictReadOwner';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { ConversationCaptureOwner } from './evidenceCaptureBatch';
const stores = new WeakMap<ConversationCaptureOwner, object>();
const owners = new WeakMap<ConversationCaptureOwner, () => boolean>();
/** Only discovery-issued exact readers opt into early capture. Live clicks stay strict. */
export function registerBoundCaptureAuthority(
  owner: ConversationCaptureOwner,
  discovery: { read: unknown },
  storage: { read: unknown; readMany: unknown },
  registry: LocalEvidenceReferenceRegistry,
) {
  if (
    !ownsConversationStrictReaders(storage) ||
    !ownsEvidenceRegistryReaders(registry)
  )
    return;
  stores.set(owner, storage);
  const original = {
    read: storage.read,
    many: storage.readMany,
    discovery: discovery.read,
  };
  owners.set(
    owner,
    () =>
      storage.read === original.read &&
      storage.readMany === original.many &&
      discovery.read === original.discovery &&
      ownsEvidenceRegistryReaders(registry),
  );
}
export function ownsBoundCaptureAuthority(owner: ConversationCaptureOwner) {
  return owners.get(owner)?.() === true;
}
/** Non-registered legacy owners retain their prior generated-only behavior. */
export function boundCaptureAuthorityUnchanged(
  owner: ConversationCaptureOwner,
) {
  return owners.get(owner)?.() ?? true;
}

/** A different binding store must not borrow the discovery store's policy. */
export function canBindBoundCapture(
  owner: ConversationCaptureOwner,
  storage: object,
) {
  return !stores.has(owner) || stores.get(owner) === storage;
}
