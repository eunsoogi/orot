import { t } from '../../i18n';
import {
  publicSearchSettingsPermissions,
  SETTINGS_CONSENT_CATALOG_VERSION,
} from './settingsConsentCatalog';
import type {
  SettingsConsentIdentity,
  SettingsConsentGrant,
} from './settingsConsentGrant';

export interface SettingsSearchChoices {
  readonly web: boolean;
  readonly medical: boolean;
}
/** Only separately checked recipients receive a grant; model approval is not search approval. */
export function settingsSearchGrants(
  identity: SettingsConsentIdentity,
  choices?: SettingsSearchChoices,
) {
  const rows: {
    domain: 'public-web' | 'medical-search';
    grant: SettingsConsentGrant;
  }[] = [];
  if (choices?.web)
    rows.push({
      domain: 'public-web',
      grant: {
        version: 1,
        catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
        identity: {
          ...identity,
          recipient: t('externalMedicalEvidence.publicSearchRecipient', {
            recipient: identity.recipient,
          }),
        },
        permissions: [publicSearchSettingsPermissions.web],
      },
    });
  if (choices?.medical)
    rows.push({
      domain: 'medical-search',
      grant: {
        version: 1,
        catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
        identity: {
          ...identity,
          providerId: 'europe-pmc',
          modelId: 'public-medical-search',
          recipient: 'Europe PMC',
        },
        permissions: [publicSearchSettingsPermissions.medical],
      },
    });
  return rows;
}
