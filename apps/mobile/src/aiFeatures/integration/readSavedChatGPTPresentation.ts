import { readChatGPTConsentCredential } from '../../providers/chatGPTConsentIdentity';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import type { ChatGPTSelectionServices } from '../../providers/selection/chatGPTServices';
import type {
  ProviderSelection,
  ProviderSelectionStore,
} from '../../providers/selection/types';
import type { OnDeviceSelectionWitness } from './provider';
import { savedChatGPTModelLabel } from './savedChatGPTModelLabel';

export type ReadReturningChatGPTTitle = (
  canRead: () => boolean,
) => ReturnType<typeof readSavedChatGPTPresentation>;

/** Local display lookup only. It cannot read an arbitrary account's title or
 * turn cached metadata into availability, processing approval, or dispatch. */
export async function readSavedChatGPTPresentation(
  selection: ProviderSelection,
  selectionCurrent: () => boolean,
  accountCurrent: () => boolean,
  fixedName?: string,
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
  const name = stored ?? fixedName;
  if (name && credential?.isCurrent())
    return {
      name,
      owner: {
        isCurrent: credential.isCurrent,
        subscribe: credential.subscribe,
      },
    };
}

/** The retained header may re-read only the originally owned local selection.
 * This never calls the catalog, authorizes dispatch, or returns a ready state. */
export function publishSavedChatGPTNames(input: {
  selection: ProviderSelection;
  selectionStore: ProviderSelectionStore;
  listAccounts: ChatGPTSelectionServices['listAccounts'];
  accountId: string;
  selectionCurrent: () => boolean;
  credentialCurrent: () => boolean;
  subscribeCredential: OnDeviceSelectionWitness['subscribe'];
  publish: (
    name: string,
    owner: OnDeviceSelectionWitness,
    onReturn: ReadReturningChatGPTTitle,
  ) => void;
}) {
  const {
    selection,
    selectionStore,
    listAccounts,
    accountId,
    selectionCurrent,
    credentialCurrent,
    subscribeCredential,
    publish,
  } = input;
  const fixed = savedChatGPTModelLabel(selection.modelId);
  const onReturn: ReadReturningChatGPTTitle = async canRead => {
    const current = () =>
      canRead() && selectionCurrent() && credentialCurrent();
    if (!current()) return;
    const fresh = await selectionStore.load();
    if (
      !current() ||
      fresh?.modelId !== selection.modelId ||
      fresh.providerId !== selection.providerId
    )
      return;
    const account = (await listAccounts()).find(
      value => value.issuedClientID === accountId,
    );
    if (
      !current() ||
      !account ||
      account.requiresSignIn ||
      !account.hasDirectPlanAccess
    )
      return;
    return readSavedChatGPTPresentation(
      selection,
      current,
      credentialCurrent,
      fixed,
    );
  };
  if (fixed)
    publish(
      fixed,
      { isCurrent: credentialCurrent, subscribe: subscribeCredential },
      onReturn,
    );
  // Cosmetic Keychain reads must never delay the independent readiness check.
  readSavedChatGPTPresentation(selection, selectionCurrent, credentialCurrent)
    .then(title => {
      if (title && selectionCurrent() && credentialCurrent())
        publish(title.name, title.owner, onReturn);
    })
    .catch(() => undefined);
}

/** Refreshing presentation cannot replace the exact prior living credential owner. */
export function withOriginalChatGPTTitleOwner(
  read: ReadReturningChatGPTTitle | undefined,
  owner: OnDeviceSelectionWitness,
): ReadReturningChatGPTTitle | undefined {
  if (!read) return;
  return async current => {
    const exact = () => current() && owner.isCurrent();
    const title = await read(exact);
    if (!title || !exact() || !title.owner.isCurrent()) return;
    return {
      ...title,
      // Keep the original owner in the final paint check as well as the read.
      owner: {
        isCurrent: () => owner.isCurrent() && title.owner.isCurrent(),
        subscribe(listener) {
          const first = owner.subscribe(() => listener());
          const second = title.owner.subscribe(() => listener());
          return () => {
            first();
            second();
          };
        },
      },
    };
  };
}
