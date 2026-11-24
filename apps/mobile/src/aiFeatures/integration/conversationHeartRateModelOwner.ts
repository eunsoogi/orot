import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import {
  chatGPTCredentialMutation,
  readChatGPTConsentCredential,
} from '../../providers/chatGPTConsentIdentity';
import { selectedChatGPTAccountId } from './savedChatGPTModelLabel';
import type { SelectedAiResolution } from './provider';

export type TypedHeartRateRecipient = Readonly<{
  providerId: string;
  modelId: string;
  modelName: string;
  recipient: string;
  remoteProcessing: boolean;
}>;

/** Capture the app's exact selected model without refreshing an account catalog or calling a provider. */
export function createTypedHeartRateModelOwner(
  selected: Extract<SelectedAiResolution, { status: 'ready' }>,
) {
  const { providerId, modelId } = selected.selection;
  if (providerId !== selected.provider.id || modelId !== selected.modelId || !selected.recipient)
    return undefined;
  const selectionCurrent = providerSelectionStore.liveWitness();
  const chatGPT = Boolean(selectedChatGPTAccountId(selected.selection));
  const credentialCurrent = chatGPT ? chatGPTCredentialMutation.capture() : undefined;
  if (!selectionCurrent || (chatGPT && !credentialCurrent)) return undefined;
  const details: TypedHeartRateRecipient = Object.freeze({
    providerId,
    modelId,
    modelName: selected.option.displayName,
    recipient: selected.recipient,
    remoteProcessing: selected.remoteProcessing,
  });
  let credential: Awaited<ReturnType<typeof readChatGPTConsentCredential>>;
  const current = () =>
    selectionCurrent() &&
    (!chatGPT || (credentialCurrent?.() === true && credential?.isCurrent() !== false));
  const recheck = async () => {
    if (!current()) return false;
    try {
      const live = await providerSelectionStore.load();
      if (live?.providerId !== providerId || live?.modelId !== modelId || !current()) return false;
      if (chatGPT) {
        const next = await readChatGPTConsentCredential();
        if (!next || (credential && credential.epoch !== next.epoch)) return false;
        credential = next;
        if (!next.isCurrent()) return false;
      }
      return current();
    } catch {
      return false;
    }
  };
  return { details, current, recheck };
}
