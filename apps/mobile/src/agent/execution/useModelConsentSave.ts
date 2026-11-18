import type { SettingsSearchChoices } from './settingsSearchGrants';
import { useEffect, useRef } from 'react';
import type {
  ProviderSelectionOption,
  ProviderSelectionStore,
} from '../../providers/selection/types';
import type { SettingsConsentSlot } from '../../storage/settingsConsentStorage';
import { saveModelSettingsConsent } from './saveModelSettingsConsent';
import { settingsConsentRecipient } from './settingsConsentRecipient';

/** Route-owned save: hidden/unmounted settings cannot finish a late grant or emit success. */
export function useModelConsentSave(
  slot: SettingsConsentSlot,
  store: ProviderSelectionStore,
) {
  const mounted = useRef(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pending.current?.abort();
    };
  }, []);
  return async (
    option: Pick<ProviderSelectionOption, 'modelId' | 'privacyBoundary'> & {
      provider: { readonly id: string };
    },
    search?: SettingsSearchChoices,
  ) => {
    if (!mounted.current || pending.current)
      throw new Error('Settings save unavailable');
    const controller = new AbortController();
    pending.current = controller;
    const remote = option.privacyBoundary === 'selected-context-remote';
    const recipient = settingsConsentRecipient(option.provider.id);
    try {
      if (remote && !recipient)
        throw new Error('Unknown transmission recipient');
      await saveModelSettingsConsent({
        slot,
        search,
        store,
        remote,
        recipient: recipient ?? '',
        selection: { providerId: option.provider.id, modelId: option.modelId },
        signal: controller.signal,
        isCurrent: () => mounted.current && pending.current === controller,
      });
      if (!mounted.current || controller.signal.aborted)
        throw new Error('Settings save cancelled');
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };
}
