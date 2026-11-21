import { useEffect, useState } from 'react';
import {
  chatGPTCredentialMutation,
  readChatGPTConsentCredential,
} from '../chatGPTConsentIdentity';
import type { ProviderSelection, ProviderSelectionStore } from './types';

/** Observe only local title metadata for the exact selection and credential.
 * Only explicit committed selection may supply a dynamic title, never vice versa. */
export function useSavedChatGPTTitle(
  store: ProviderSelectionStore,
  selection: ProviderSelection | null,
) {
  const [title, setTitle] = useState<{
    store: ProviderSelectionStore;
    selection: ProviderSelection;
    name: string;
    current: () => boolean;
  }>();
  useEffect(() => {
    if (!selection?.providerId.startsWith('chatgpt-plan:') || !store.loadTitle)
      return;
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const clear = () => {
      active = false;
      setTitle(previous =>
        previous?.selection === selection ? undefined : previous,
      );
    };
    const cancelSelection = store.subscribeChanges?.(clear);
    const cancelMutation = chatGPTCredentialMutation.subscribe(clear);
    async function load(exact: ProviderSelection) {
      const credential = await readChatGPTConsentCredential();
      if (!active || !credential?.isCurrent()) return;
      unsubscribe = credential.subscribe(clear);
      const current = () => active && credential.isCurrent();
      if (!current()) return;
      const name = await store.loadTitle?.(exact, credential.epoch);
      if (name && current())
        setTitle({ store, selection: exact, name, current });
    }
    load(selection).catch(() => undefined);
    return () => {
      active = false;
      cancelSelection?.();
      cancelMutation();
      unsubscribe?.();
    };
  }, [store, selection]);
  return title?.store === store &&
    title.selection === selection &&
    title.current()
    ? title.name
    : undefined;
}
