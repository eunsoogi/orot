import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { APPLE_PCC_PROVIDER_ID } from '../../providers/selection/privateCloudCompute';
import {
  initializeChatGPTConsentCredential,
  readChatGPTConsentCredential,
} from '../../providers/chatGPTConsentIdentity';
import { voiceSettingsStore } from '../../voiceSettings/voiceSettingsStore';
import { apiCredentialMutation } from '../../voiceSettings/voiceConsentIdentity';

/** Resolve only credential ownership, never provider availability or a permission grant.
 * Raw secrets never leave their existing Keychain adapter. Legacy API credentials get
 * an epoch only from an explicit settings decision; inference reads cannot initialize it. */
export async function settingsConsentCredential(
  providerId: string,
  initialize = false,
) {
  if (providerId === APPLE_PROVIDER_ID)
    return {
      epoch: 'apple-on-device-selection-v1',
      isCurrent: () => true,
      subscribe: (_listener: () => void) => () => {},
    };
  if (providerId === APPLE_PCC_PROVIDER_ID)
    return {
      epoch: 'apple-platform-pcc-v1',
      isCurrent: () => true,
      subscribe: (_listener: () => void) => () => {},
    };
  if (providerId.startsWith('chatgpt-plan:')) {
    const existing = await readChatGPTConsentCredential();
    if (existing || !initialize) return existing;
    const accountId = providerId.slice(
      'chatgpt-plan:'.length,
      providerId.lastIndexOf(':'),
    );
    const { listOpenAIAccounts } = await import('../../providers/openai');
    await initializeChatGPTConsentCredential(async () => {
      const accounts = await listOpenAIAccounts();
      return accounts.some(
        account =>
          account.issuedClientID === accountId &&
          !account.requiresSignIn &&
          account.hasDirectPlanAccess,
      );
    });
    return readChatGPTConsentCredential();
  }
  if (
    providerId === 'openai-api-decisions' ||
    providerId === 'openai-realtime'
  ) {
    const witness = apiCredentialMutation.capture();
    if (!witness) return null;
    const epoch = await voiceSettingsStore.consentAccountEpoch(initialize);
    return epoch && witness()
      ? {
          epoch,
          isCurrent: witness,
          subscribe: apiCredentialMutation.subscribe,
        }
      : null;
  }
  return null;
}
