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
    const credentials = await getGenericPassword({ service: this.service });
    return credentials === false ? null : parseSelection(credentials.password);
  }

  subscribeChanges(listener: () => void) {
    return selectionOwner(this.service).subscribe(listener);
  }
  liveWitness() {
    return selectionOwner(this.service).capture();
  }

  async save(value: ProviderSelection): Promise<void> {
    const selection = requireSelection(value);
    const finish = selectionOwner(this.service).begin();
    try {
      const saved = await setGenericPassword(
        KEYCHAIN_ACCOUNT,
        JSON.stringify(selection),
        {
          service: this.service,
          accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        },
      );
      if (saved === false) {
        throw new Error('The provider selection could not be saved.');
      }
    } finally {
      finish();
    }
  }

  async clear(): Promise<void> {
    const finish = selectionOwner(this.service).begin();
    try {
      await resetGenericPassword({ service: this.service });
    } finally {
      finish();
    }
  }
}

export const providerSelectionStore = new KeychainProviderSelectionStore();
