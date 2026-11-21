import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { chatGPTCredentialMutation } from '../../providers/chatGPTConsentIdentity';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import { captureConversationSelectionWitness } from './conversationSelectionWitness';
import type { SelectedAiResolverOptions } from './provider';

/** Only the native resolution paths with observed credentials can hold a page
 * across tab return. Overrides and PCC availability remain strict restarts. */
export function captureNativeConversationSelectionWitness(
  options?: SelectedAiResolverOptions,
) {
  if (options?.selectionStore) return undefined;
  const selection = captureConversationSelectionWitness(
    { capture: () => providerSelectionStore.liveWitness() },
    chatGPTCredentialMutation,
  );
  return (id: string) => {
    if (
      (id === APPLE_PROVIDER_ID && !options?.loadAppleOption) ||
      (id.startsWith('chatgpt-plan:') && !options?.chatGPTServices)
    )
      return selection(id);
    return null;
  };
}
