import { createCredentialMutationOwner } from '../agent/execution/credentialMutation';

export const apiCredentialMutation = createCredentialMutationOwner();
export const voiceSelectionMutation = createCredentialMutationOwner();
export function beginVoiceSettingsMutation(changesCredential: boolean) {
  const selection = voiceSelectionMutation.begin();
  const credential = changesCredential
    ? apiCredentialMutation.begin()
    : () => {};
  return () => {
    credential();
    selection();
  };
}
import { createConsentGeneration } from '../agent/execution/consentGeneration';

/** The API key and its non-secret epoch share one device-only Keychain write.
 * Legacy keys acquire an epoch only during explicit settings approval. Read-only
 * inference resolution never upgrades an old credential into a consented identity. */
export function createVoiceConsentIdentity<
  T extends { apiKey: string; credentialEpoch?: string },
>(input: {
  read: () => Promise<T>;
  write: (value: T) => Promise<void>;
  enqueue: (work: () => Promise<void>) => Promise<void>;
}) {
  return {
    async consentAccountEpoch(initialize = false): Promise<string | null> {
      let epoch: string | null = null;
      await input.enqueue(async () => {
        const value = await input.read();
        if (!value.apiKey) return;
        if (value.credentialEpoch) {
          epoch = value.credentialEpoch;
          return;
        }
        if (!initialize) return;
        const next = createConsentGeneration();
        await input.write({ ...value, credentialEpoch: next });
        epoch = next;
      });
      return epoch;
    },
  };
}
