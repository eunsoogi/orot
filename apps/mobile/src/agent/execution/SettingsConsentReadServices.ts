import { createContext, useContext } from 'react';
import { resolveSettingsConsentOwner } from './settingsConsentOwner';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import type { createSettingsConsentAuthorization } from './settingsConsentAuthorization';

type AuthorizationInput = Parameters<
  typeof createSettingsConsentAuthorization
>[0];
export type SettingsConsentReadServices = Pick<
  AuthorizationInput,
  'resolveOwner' | 'readGrant'
>;

// A scoped native fixture may supply isolated protected stores. It cannot replace
// the catalog, authorization algorithm, payload matching or mounted-owner fences.
const production: SettingsConsentReadServices = {
  resolveOwner: resolveSettingsConsentOwner,
  readGrant: async (slot, domain) =>
    (await settingsConsentRepository()).read(slot, domain),
};
export const SettingsConsentReadServicesContext = createContext(production);
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
