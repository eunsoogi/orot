import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import { createConsentAuthority } from '../agent/execution/consentAuthority';
import { createCredentialMutationOwner } from '../agent/execution/credentialMutation';
import { createConsentGeneration } from '../agent/execution/consentGeneration';

const service = 'com.orot.mobile.chatgpt-consent-credential.v1';
export const chatGPTCredentialMutation = createCredentialMutationOwner();
const credential = createConsentAuthority(
  {
    async read() {
      const stored = await getGenericPassword({ service });
      if (!stored) return null;
      try {
        return JSON.parse(stored.password) as unknown;
      } catch {
        return { invalid: true };
      }
    },
    async write(value) {
      const saved = await setGenericPassword(
        'chatgpt-consent-credential',
        JSON.stringify(value),
        {
          service,
          accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        },
      );
      if (!saved)
        throw new Error('Account permission identity could not be saved');
    },
  },
  createConsentGeneration,
);

const pendingSignIns = new Set<() => void>();
export function cancelPendingChatGPTConsentSignIn() {
  for (const cancel of pendingSignIns) cancel();
}

/** Native sign-in may select an account only after an asynchronous browser flow.
 * Suspend before entering it, including across a crash. Cancellation is not proof
 * that the native credential did not change, so it never restores old permission.
 * This non-secret epoch covers ChatGPT credentials only, not API/PCC/local choices. */
export async function mutateChatGPTConsentCredential<T>(
  operation: () => Promise<T>,
  removing: boolean,
): Promise<T> {
  const finish = chatGPTCredentialMutation.begin();
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    credential.suspend().catch(() => undefined);
  };
  if (!removing) pendingSignIns.add(cancel);
  try {
    let suspension: Awaited<ReturnType<typeof credential.suspend>> | undefined;
    try {
      suspension = await credential.suspend();
    } catch (error) {
      // Logout still removes the actual credential; a failed tombstone cannot trap it.
      if (!removing) throw error;
    }
    if (cancelled) throw new Error('Account sign-in cancelled');
    const result = await operation();
    // Removal leaves the tombstone. New sign-in creates an epoch, not an inference grant.
    if (
      !removing &&
      (!suspension ||
        !(await credential.complete(suspension, async () => !cancelled)))
    )
      throw new Error('Account permission identity changed');
    return result;
  } finally {
    pendingSignIns.delete(cancel);
    finish();
  }
}

/** Read-only resolution never upgrades an old account to a consented identity. */
export async function readChatGPTConsentCredential() {
  const mutation = chatGPTCredentialMutation.capture();
  if (!mutation) return null;
  const state = await credential.current();
  if (!state || !mutation()) return null;
  const authority = credential.witness(state.generation);
  return {
    epoch: state.generation,
    isCurrent: () => mutation() && authority(),
    subscribe: (listener: () => void) => {
      const a = chatGPTCredentialMutation.subscribe(listener);
      const b = credential.subscribe(listener);
      return () => {
        a();
        b();
      };
    },
  };
}

/** Explicit settings consent may initialize a legacy account only from absent metadata. */
export async function initializeChatGPTConsentCredential(
  stillValid: () => Promise<boolean>,
) {
  const witness = chatGPTCredentialMutation.capture();
  if (!witness) return false;
  return credential.initializeMissing(
    async () => witness() && (await stillValid()) && witness(),
  );
}
