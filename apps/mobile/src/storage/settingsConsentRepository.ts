import { createSettingsConsentStorage } from './settingsConsentStorage';

let pending:
  Promise<ReturnType<typeof createSettingsConsentStorage>> | undefined;
/** Reuse only the encrypted repository handle, never an authorization decision. */
export function settingsConsentRepository() {
  return (pending ??= import('./secureDatabase')
    .then(module => module.openLocalAgentMemoryDatabase())
    .then(createSettingsConsentStorage)
    .catch(error => {
      pending = undefined;
      throw error;
    }));
}
