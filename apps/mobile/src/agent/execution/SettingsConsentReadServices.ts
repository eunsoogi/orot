import { createContext, useContext } from 'react';
import {
  resolveSettingsConsentOwner,
  resolveSettingsConsentTarget,
} from './settingsConsentOwner';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import type { createSettingsConsentAuthorization } from './settingsConsentAuthorization';

type AuthorizationInput = Parameters<
  typeof createSettingsConsentAuthorization
>[0];
export type SettingsConsentReadServices = Pick<
  AuthorizationInput,
  'resolveOwner' | 'readGrant'
> & { readonly resolveTarget?: typeof resolveSettingsConsentTarget };

// A scoped native fixture may supply isolated protected stores. It cannot replace
// the catalog, authorization algorithm, payload matching or mounted-owner fences.
export const productionSettingsConsentReadServices: SettingsConsentReadServices =
  {
    resolveOwner: resolveSettingsConsentOwner,
    resolveTarget: resolveSettingsConsentTarget,
    readGrant: async (slot, domain) =>
      (await settingsConsentRepository()).read(slot, domain),
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
