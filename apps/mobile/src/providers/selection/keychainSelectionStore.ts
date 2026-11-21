import { createCredentialMutationOwner } from '../../agent/execution/credentialMutation';
import {
  ACCESSIBLE,
  getGenericPassword,
  resetGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import type { ProviderSelection, ProviderSelectionStore } from './types';

const KEYCHAIN_SERVICE = 'com.orot.mobile.provider-selection.v1';
const KEYCHAIN_ACCOUNT = 'provider-selection';
const owners = new Map<
  string,
  ReturnType<typeof createCredentialMutationOwner>
>();
function selectionOwner(service: string) {
  let owner = owners.get(service);
  if (!owner) {
    owner = createCredentialMutationOwner();
    owners.set(service, owner);
  }
  return owner;
}

const selectionWrites = new Map<string, Promise<unknown>>();
/** Same-service writers must settle in request order; unrelated slots stay independent. */
function serializeSelectionWrite<T>(service: string, write: () => Promise<T>) {
  const next = (selectionWrites.get(service) ?? Promise.resolve())
    .catch(() => undefined)
    .then(write)
    .finally(() => {
      if (selectionWrites.get(service) === next)
        selectionWrites.delete(service);
    });
  selectionWrites.set(service, next);
  return next;
}

function sameSelection(
  left: ProviderSelection | null,
  right: ProviderSelection | null,
) {
  return (
    left?.providerId === right?.providerId && left?.modelId === right?.modelId
  );
}

function isIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 1024
  );
}

function parseSelection(value: string): ProviderSelection | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length !== 2 ||
      !keys.includes('providerId') ||
      !keys.includes('modelId') ||
      !isIdentifier(record.providerId) ||
      !isIdentifier(record.modelId)
    ) {
      return null;
    }
    return { providerId: record.providerId, modelId: record.modelId };
  } catch {
    return null;
  }
}

function requireSelection(value: ProviderSelection): ProviderSelection {
  if (!isIdentifier(value.providerId) || !isIdentifier(value.modelId)) {
    throw new Error('Provider and model identifiers are required.');
  }
  // Rebuild the allowlisted record so credentials or context cannot be copied into storage.
  return { providerId: value.providerId, modelId: value.modelId };
}

export class KeychainProviderSelectionStore implements ProviderSelectionStore {
  /** Each feature owns its selection; credentials are never stored in this item. */
  constructor(private readonly service = KEYCHAIN_SERVICE) {}
  async load(): Promise<ProviderSelection | null> {
    const inspected = await this.inspect();
    return inspected.selection;
  }

  subscribeChanges(listener: () => void) {
    return selectionOwner(this.service).subscribe(listener);
  }
  liveWitness() {
    return selectionOwner(this.service).capture();
  }

  private async inspect() {
    const credentials = await getGenericPassword({ service: this.service });
    if (credentials === false) return { selection: null, readable: true };
    const selection = parseSelection(credentials.password);
    return { selection, readable: selection !== null };
  }

  private async write(value: ProviderSelection | null) {
    if (value === null) {
      if (!(await resetGenericPassword({ service: this.service })))
        throw new Error('The provider selection could not be cleared.');
      return;
    }
    const saved = await setGenericPassword(
      KEYCHAIN_ACCOUNT,
      JSON.stringify(value),
      {
        service: this.service,
        accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    );
    if (saved === false)
      throw new Error('The provider selection could not be saved.');
  }

  private mutate<T>(work: () => Promise<T>) {
    const finish = selectionOwner(this.service).begin();
    return serializeSelectionWrite(this.service, work).finally(finish);
  }

  async save(value: ProviderSelection): Promise<void> {
    const selection = requireSelection(value);
    await this.mutate(() => this.write(selection));
  }

  async clear(): Promise<void> {
    await this.mutate(async () => {
      // Normal clear is idempotent even if there is no previous native value.
      await resetGenericPassword({ service: this.service });
    });
  }

  /** Stage a specifically reviewed replacement, including a true first-time
   * empty slot. An unreadable or subsequently replaced slot never matches null.
   * Generation invalidation happens before native work. The returned witness
   * is valid only if no competing writer was queued, including same-model saves. */
  async replaceOwned(
    expected: ProviderSelection | null,
    value: ProviderSelection | null,
    captured: () => boolean,
    requestCurrent: () => boolean,
  ): Promise<(() => boolean) | null> {
    if (!captured() || !requestCurrent()) return null;
    const want = expected === null ? null : requireSelection(expected);
    const replacement = value === null ? null : requireSelection(value);
    // The mutation owner synchronously increments exactly once in mutate. A
    // witness detached before the queue begins cannot prove who wrote afterward.
    const owner = selectionOwner(this.service);
    let invalidated = false;
    let observedSelf = false;
    const stop = owner.subscribe(() => {
      if (observedSelf) invalidated = true;
      observedSelf = true;
    });
    try {
      const changed = await this.mutate(async () => {
        const inspected = await this.inspect();
        if (
          invalidated ||
          !requestCurrent() ||
          !inspected.readable ||
          !sameSelection(inspected.selection, want)
        )
          return false;
        await this.write(replacement);
        return true;
      });
      if (!changed || invalidated) return null;
      return owner.capture();
    } finally {
      stop();
    }
  }
}

export const providerSelectionStore = new KeychainProviderSelectionStore();
