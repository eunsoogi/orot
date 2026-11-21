import { createContext, useContext } from 'react';
import {
  resolveSettingsConsentOwner,
  resolveSettingsConsentTarget,
} from './settingsConsentOwner';
import { settingsConsentAuthority } from '../../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import type { createSettingsConsentStorage } from '../../storage/settingsConsentStorage';
import type { createSettingsConsentAuthorization } from './settingsConsentAuthorization';

type AuthorizationInput = Parameters<
  typeof createSettingsConsentAuthorization
>[0];
export type SettingsConsentReadServices = Pick<
  AuthorizationInput,
  'resolveOwner' | 'readGrant'
> & {
  /** UI-only proof that this fixed settings owner cannot use a persisted grant. */
  readonly reviewInactiveConversationAuthority?: () => Promise<
    (() => boolean) | null
  >;
  readonly resolveTarget?: typeof resolveSettingsConsentTarget;
  readonly readReviewGrant?: ReturnType<
    typeof createSettingsConsentStorage
  >['readReviewGrant'];
};

// A scoped native fixture may supply isolated protected stores. It cannot replace
// the catalog, authorization algorithm, payload matching or mounted-owner fences.
export const productionSettingsConsentReadServices: SettingsConsentReadServices =
  {
    resolveOwner: resolveSettingsConsentOwner,
    resolveTarget: resolveSettingsConsentTarget,
    reviewInactiveConversationAuthority: () =>
      settingsConsentAuthority('conversation').reviewInactive(),
    readGrant: async (slot, domain) =>
      (await settingsConsentRepository()).read(slot, domain),
    readReviewGrant: async (slot, domain) =>
      (await settingsConsentRepository()).readReviewGrant(slot, domain),
  };
export const SettingsConsentReadServicesContext = createContext(
  productionSettingsConsentReadServices,
);
export function useSettingsConsentReadServices() {
  const services = useContext(SettingsConsentReadServicesContext);
  if (
    !services ||
    typeof services.resolveOwner !== 'function' ||
    typeof services.readGrant !== 'function'
  )
    throw new Error('Complete settings consent read services required');
  return services;
}
