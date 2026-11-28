import { useEffect, useRef, useState } from 'react';
import type { ChatGPTPlanModelDescriptor } from '@orot/provider-openai';
import {
  ACCESSIBLE,
  getGenericPassword,
  setGenericPassword,
} from 'react-native-keychain';
import {
  chatGPTCredentialMutation,
  readChatGPTConsentCredential,
} from '../chatGPTConsentIdentity';
import {
  isIssuedClientID,
  type OpenAIAccountSummary,
} from '../openaiAccountSummary';
import { createChatGPTSelectionOptions } from './options';
import type { ProviderSelection, ProviderSelectionStore } from './types';
import { useSavedChatGPTTitle } from './useSavedChatGPTTitle';

const prefix = 'com.orot.mobile.chatgpt-display-catalog.v1';
const maxCatalog = 256;
const cacheWrites = new Map<string, Promise<unknown>>();

function parseModels(
  value: unknown,
): readonly ChatGPTPlanModelDescriptor[] | null {
  if (!Array.isArray(value) || value.length > maxCatalog) return null;
  const results: ChatGPTPlanModelDescriptor[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const { slug, displayName } = entry as Record<string, unknown>;
    if (
      typeof slug !== 'string' ||
      !slug ||
      slug.length > 256 ||
      slug !== slug.trim() ||
      typeof displayName !== 'string' ||
      !displayName.trim() ||
      displayName.length > 160
    )
      return null;
    results.push({ slug, displayName });
  }
  return new Set(results.map(model => model.slug)).size === results.length
    ? results
    : null;
}

export function useSavedChatGPTAccount(
  selectionStore: ProviderSelectionStore,
  enabled: boolean,
) {
  const [owner, setOwner] = useState<{
    store: ProviderSelectionStore;
    id: string;
    selection: ProviderSelection;
  }>();
  useEffect(() => {
    if (!enabled) return;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      setOwner(undefined);
      const selection = await selectionStore.load();
      if (
        request !== generation ||
        !selection?.providerId.startsWith('chatgpt-plan:')
      )
        return;
      const suffix = `:${selection.modelId}`;
      if (!selection.providerId.endsWith(suffix)) return;
      const id = selection.providerId.slice(
        'chatgpt-plan:'.length,
        -suffix.length,
      );
      if (isIssuedClientID(id))
        setOwner({ store: selectionStore, id, selection });
    };
    const start = () => {
      refresh().catch(() => undefined);
    };
    const unsubscribe = selectionStore.subscribeChanges?.(start);
    start();
    return () => {
      generation++;
      unsubscribe?.();
    };
  }, [enabled, selectionStore]);
  return enabled && owner?.store === selectionStore ? owner : undefined;
}

/** Disk entries contain display metadata only. They cannot provide provider readiness. */
export function useChatGPTDisplayCatalog(accountID: string | undefined) {
  const owner = useRef({ accountID, mounted: false });
  owner.current.accountID = accountID;
  const [snapshot, setSnapshot] = useState<{
    accountID: string;
    models: readonly ChatGPTPlanModelDescriptor[];
    current: () => boolean;
  }>();

  useEffect(() => {
    owner.current.mounted = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      setSnapshot(undefined);
      if (!accountID) return;
      const witness = await readChatGPTConsentCredential();
      const current = () =>
        request === generation &&
        owner.current.accountID === accountID &&
        witness?.isCurrent() === true;
      if (!witness || !current()) return;
      const raw = await getGenericPassword({
        service: `${prefix}.${accountID}`,
      });
      if (!raw || !current()) return;
      const parsed: unknown = JSON.parse(raw.password);
      if (!parsed || typeof parsed !== 'object') return;
      const { epoch, models } = parsed as Record<string, unknown>;
      const validated = parseModels(models);
      if (epoch === witness.epoch && validated && current())
        setSnapshot({ accountID, models: validated, current });
    };
    const start = () => {
      refresh().catch(() => undefined);
    };
    const unsubscribe = chatGPTCredentialMutation.subscribe(start);
    start();
    return () => {
      owner.current.mounted = false;
      generation++;
      unsubscribe();
    };
  }, [accountID]);

  async function captureRefresh(issuedClientID: string) {
    if (!accountID || accountID !== issuedClientID) return;
    const witness = await readChatGPTConsentCredential();
    if (!witness?.isCurrent()) return;
    return async (catalog: readonly ChatGPTPlanModelDescriptor[]) => {
      const current = () =>
        owner.current.mounted &&
        owner.current.accountID === issuedClientID &&
        witness.isCurrent();
      const models = parseModels(catalog);
      if (!models || !current()) return;
      setSnapshot({ accountID: issuedClientID, models, current });
      // An older in-flight Keychain write cannot overwrite a newer credential's catalog.
      const write = (cacheWrites.get(issuedClientID) ?? Promise.resolve())
        .catch(() => undefined)
        .then(async () => {
          if (!current()) return;
          await setGenericPassword(
            'chatgpt-display-catalog',
            JSON.stringify({
              epoch: witness.epoch,
              models,
            }),
            {
              service: `${prefix}.${issuedClientID}`,
              accessible: ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            },
          );
        })
        .finally(() => {
          if (cacheWrites.get(issuedClientID) === write)
            cacheWrites.delete(issuedClientID);
        });
      cacheWrites.set(issuedClientID, write);
      await write;
    };
  }

  const shown =
    accountID && snapshot?.accountID === accountID && snapshot.current()
      ? snapshot.models
      : undefined;
  return { shown, captureRefresh };
}

export function useConversationCatalogState(input: {
  selectionStore: ProviderSelectionStore;
  enabled: boolean;
  selectedAccountID: string | null;
  accounts: readonly OpenAIAccountSummary[];
  canReadCatalog: boolean;
}) {
  const {
    selectionStore,
    enabled,
    accounts,
    selectedAccountID,
    canReadCatalog,
  } = input;
  const saved = useSavedChatGPTAccount(selectionStore, enabled);
  const selectedAccount = accounts.find(
    account => account.issuedClientID === (selectedAccountID ?? saved?.id),
  );
  const displayAccountID = selectedAccount?.issuedClientID ?? selectedAccountID;
  const account =
    enabled &&
    canReadCatalog &&
    selectedAccount?.hasDirectPlanAccess &&
    !selectedAccount.requiresSignIn
      ? selectedAccount.issuedClientID
      : undefined;
  const catalog = useChatGPTDisplayCatalog(account);
  const title = useSavedChatGPTTitle(
    selectionStore,
    account && saved?.id === account ? saved.selection : null,
  );
  // Upgrading an existing install may have an exact saved title but not a full cache.
  const displayModels =
    catalog.shown ??
    (title && saved
      ? [{ slug: saved.selection.modelId, displayName: title }]
      : []);
  const cachedOptions = account
    ? createChatGPTSelectionOptions(account, displayModels).map(option => ({
        ...option,
        availability: { status: 'unavailable' as const, message: '' },
      }))
    : [];
  return {
    selectedAccount,
    displayAccountID,
    cachedOptions,
    captureRefresh: catalog.captureRefresh,
  };
}
