import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import { settingsConsentAuthority } from '../../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import { settingsConsentCredential } from './settingsConsentCredential';
import { createDailyReportRecoveryOwnerReader } from './dailyReportRecoveryOwnerReader';

/** Normal application ownership is fixed here, never selected by pending metadata. */
export const readDailyReportRecoveryOwner =
  createDailyReportRecoveryOwnerReader({
    providerSelectionStore,
    settingsConsentAuthority,
    settingsConsentRepository,
    settingsConsentCredential,
  });
