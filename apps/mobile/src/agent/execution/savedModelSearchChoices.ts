import { t } from '../../i18n';
import type { ProviderSelectionOption } from '../../providers/selection/types';
import { canReuseConsent, consentRevision } from './consentRevision';
import {
  publicSearchSettingsPermissions,
  SETTINGS_CONSENT_CATALOG_VERSION,
} from './settingsConsentCatalog';
import type {
  SettingsConsentIdentity,
  SettingsConsentPermission,
} from './settingsConsentGrant';
import type { SettingsConsentReadServices } from './SettingsConsentReadServices';
import { settingsConsentRecipient } from './settingsConsentRecipient';
import type { SettingsSearchChoices } from './settingsSearchGrants';

export const uncheckedSearchChoices: SettingsSearchChoices = {
  web: false,
  medical: false,
};

const sameIdentity = (a: SettingsConsentIdentity, b: SettingsConsentIdentity) =>
  a.providerId === b.providerId &&
  a.modelId === b.modelId &&
  a.recipient === b.recipient &&
  a.authorityGeneration === b.authorityGeneration &&
  a.credentialEpoch === b.credentialEpoch;

const permissionKey = (permission: SettingsConsentPermission) =>
  JSON.stringify([
    permission.purpose,
    permission.policyVersion,
    [...permission.dataCategories].sort(),
    [...permission.sourceKinds].sort(),
  ]);

/** Preload current same-model settings only. This does not authorize or create a new grant. */
export async function readSavedModelSearchChoices(
  services: SettingsConsentReadServices,
  option: ProviderSelectionOption,
  signal: AbortSignal,
): Promise<{ choices: SettingsSearchChoices; current(): boolean } | undefined> {
  if (!services.resolveTarget || !services.readReviewGrant) return undefined;
  const rev = consentRevision();
  const current = () =>
    !signal.aborted && canReuseConsent() && consentRevision() === rev;
  if (!current()) return undefined;
  const selected = { providerId: option.provider.id, modelId: option.modelId };
  const recipient = settingsConsentRecipient(selected.providerId);
  const web = Boolean(
    recipient &&
    option.provider.searchPublicWeb &&
    option.privacyBoundary === 'selected-context-remote',
  );
  const requests = [
    ...(web
      ? [
          {
            key: 'web',
            domain: 'public-web',
            expected: publicSearchSettingsPermissions.web,
            ...selected,
            recipient: t('externalMedicalEvidence.publicSearchRecipient', {
              recipient: recipient!,
            }),
          } as const,
        ]
      : []),
    {
      key: 'medical',
      domain: 'medical-search',
      providerId: 'europe-pmc',
      modelId: 'public-medical-search',
      recipient: 'Europe PMC',
      expected: publicSearchSettingsPermissions.medical,
    } as const,
  ];
  const choices = { ...uncheckedSearchChoices };
  const witnesses: (() => boolean)[] = [];
  try {
    for (const { key, domain, expected, ...target } of requests) {
      const read = await services.readReviewGrant('conversation', domain);
      if (!current() || read.status === 'unreadable') return undefined;
      if (read.status !== 'present') continue;
      const owner = await services.resolveTarget('conversation', domain, {
        ...target,
        selected,
        signal,
      });
      if (!owner) {
        // A stale positive row can survive intentional local suspension or durable
        // revocation. Only a proven inactive generation may be reviewed unchecked.
        const inactive = await services.reviewInactiveConversationAuthority?.();
        if (!current() || !inactive?.()) return undefined;
        witnesses.push(inactive);
        continue;
      }
      if (
        !current() ||
        !owner.isCurrent() ||
        owner.slot !== 'conversation' ||
        owner.domain !== domain ||
        owner.identity.providerId !== target.providerId ||
        owner.identity.modelId !== target.modelId ||
        owner.identity.recipient !== target.recipient
      )
        return undefined;
      witnesses.push(owner.isCurrent);
      const { grant } = read;
      choices[key] =
        sameIdentity(grant.identity, owner.identity) &&
        grant.catalogVersion === SETTINGS_CONSENT_CATALOG_VERSION &&
        grant.permissions.length === 1 &&
        permissionKey(grant.permissions[0]!) === permissionKey(expected);
    }
    const stillCurrent = () =>
      current() && witnesses.every(validate => validate());
    return stillCurrent() ? { choices, current: stillCurrent } : undefined;
  } catch {
    return undefined;
  }
}
