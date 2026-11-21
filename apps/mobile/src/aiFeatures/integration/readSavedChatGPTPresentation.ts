import { readChatGPTConsentCredential } from '../../providers/chatGPTConsentIdentity';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import type { ProviderSelection } from '../../providers/selection/types';
import type { OnDeviceSelectionWitness } from './provider';

/** Local display lookup only. It cannot read an arbitrary account's title or
 * turn cached metadata into availability, processing approval, or dispatch. */
export async function readSavedChatGPTPresentation(
  selection: ProviderSelection,
  selectionCurrent: () => boolean,
  accountCurrent: () => boolean,
): Promise<{ name: string; owner: OnDeviceSelectionWitness } | undefined> {
  const current = () => selectionCurrent() && accountCurrent();
  if (!current()) return;
  const credential = await readChatGPTConsentCredential().catch(() => null);
  const stored =
    current() && credential?.isCurrent()
      ? await providerSelectionStore
          .loadTitle(selection, credential.epoch)
          .catch(() => undefined)
      : undefined;
  if (!current()) return;
  if (stored && credential?.isCurrent())
    return {
      name: stored,
      owner: {
        isCurrent: credential.isCurrent,
        subscribe: credential.subscribe,
      },
    };
}
