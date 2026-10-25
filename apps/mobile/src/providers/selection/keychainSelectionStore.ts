import {
  ACCESSIBLE,
  getGenericPassword,
  resetGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import type { ProviderSelection, ProviderSelectionStore } from './types';

const KEYCHAIN_SERVICE = 'com.orot.mobile.provider-selection.v1';
const KEYCHAIN_ACCOUNT = 'provider-selection';

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
  async load(): Promise<ProviderSelection | null> {
    const credentials = await getGenericPassword({ service: KEYCHAIN_SERVICE });
    return credentials === false ? null : parseSelection(credentials.password);
  }

  async save(value: ProviderSelection): Promise<void> {
    const selection = requireSelection(value);
    const saved = await setGenericPassword(
      KEYCHAIN_ACCOUNT,
      JSON.stringify(selection),
      {
        service: KEYCHAIN_SERVICE,
        accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      },
    );
    if (saved === false) {
      throw new Error('The provider selection could not be saved.');
    }
  }

  async clear(): Promise<void> {
    await resetGenericPassword({ service: KEYCHAIN_SERVICE });
  }
}

export const providerSelectionStore = new KeychainProviderSelectionStore();
