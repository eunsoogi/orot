import { useMemo, useRef, useEffect } from 'react';
import type { ReactElement } from 'react';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import { createSettingsConsentAuthorization } from './settingsConsentAuthorization';
import { resolveSettingsConsentOwner } from './settingsConsentOwner';
import { SETTINGS_CONSENT_CATALOG_VERSION } from './settingsConsentCatalog';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';

export interface InferenceConsentController {
  readonly consent: ExecutionConsentPort;
  readonly disclosureSheet: ReactElement | null;
}

/** Conversation execution never displays a recurring transmission prompt. Missing,
 * expired or changed settings permission returns renewal_required; it does not send.
 * Settings owns the explicit disclosure and source validation still runs per request. */
export function useInferenceConsent(): InferenceConsentController {
  const active = useRef(false);
  const listeners = useRef(new Set<() => void>());
  useEffect(() => {
    active.current = true;
    const ownedListeners = listeners.current;
    return () => {
      active.current = false;
      for (const notify of ownedListeners) notify();
      ownedListeners.clear();
    };
  }, []);
  const consent = useMemo(
    () =>
      createSettingsConsentAuthorization({
        catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
        resolveOwner: async request => {
          if (!active.current) return null;
          const owner = await resolveSettingsConsentOwner(request);
          if (!owner || !active.current) return null;
          return {
            ...owner,
            isCurrent: () => active.current && owner.isCurrent(),
            subscribeInvalidation: listener => {
              listeners.current.add(listener);
              const stop =
                owner.subscribeInvalidation?.(listener) ?? (() => {});
              return () => {
                listeners.current.delete(listener);
                stop();
              };
            },
          };
        },
        readGrant: async (slot, domain) =>
          (await settingsConsentRepository()).read(slot, domain),
      }),
    [],
  );
  return { consent, disclosureSheet: null };
}
