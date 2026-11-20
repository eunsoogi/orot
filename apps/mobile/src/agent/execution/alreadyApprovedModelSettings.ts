import { t } from '../../i18n';
import type { ProviderSelectionOption } from '../../providers/selection/types';
import type { SettingsConsentDomain } from '../../storage/settingsConsentStorage';
import { canReuseConsent, consentRevision } from './consentRevision';
import {
  isCatalogDomainPermission,
  publicSearchSettingsPermissions,
  SETTINGS_CONSENT_CATALOG_VERSION,
  settingsPermissionsForFeature,
} from './settingsConsentCatalog';
import {
  parseSettingsConsentGrant,
  type SettingsConsentIdentity,
  type SettingsConsentPermission,
} from './settingsConsentGrant';
import { settingsConsentRecipient } from './settingsConsentRecipient';
import type { SettingsConsentReadServices } from './SettingsConsentReadServices';
import type { SettingsSearchChoices } from './settingsSearchGrants';

type Slot = 'calendar' | 'conversation';
const equalIdentity = (
  a: SettingsConsentIdentity,
  b: SettingsConsentIdentity,
) =>
  a.providerId === b.providerId &&
  a.modelId === b.modelId &&
  a.recipient === b.recipient &&
  a.authorityGeneration === b.authorityGeneration &&
  a.credentialEpoch === b.credentialEpoch;
const permissionID = (permission: SettingsConsentPermission) =>
  JSON.stringify([
    permission.purpose,
    permission.policyVersion,
    [...permission.dataCategories].sort(),
    [...permission.sourceKinds].sort(),
  ]);
const exactSet = (
  actual: readonly SettingsConsentPermission[],
  expected: readonly SettingsConsentPermission[],
) =>
  JSON.stringify(actual.map(permissionID).sort()) ===
  JSON.stringify(expected.map(permissionID).sort());

/** Positive identity and exact whole-scope match only; no fallback grant or fabricated runtime request. */
export async function alreadyApprovedModelSettings(input: {
  services: SettingsConsentReadServices;
  slot: Slot;
  option: ProviderSelectionOption;
  search?: SettingsSearchChoices;
  signal: AbortSignal;
  isCurrent: () => boolean;
}): Promise<boolean> {
  const { services, slot, option, search, signal, isCurrent } = input;
  if (
    !services.resolveTarget ||
    signal.aborted ||
    !isCurrent() ||
    !canReuseConsent()
  )
    return false;
  const revision = consentRevision();
  const current = () =>
    !signal.aborted &&
    isCurrent() &&
    canReuseConsent() &&
    consentRevision() === revision;
  const selected = { providerId: option.provider.id, modelId: option.modelId };
  const recipient = settingsConsentRecipient(selected.providerId);
  if (!recipient) return false;
  const remote = option.privacyBoundary === 'selected-context-remote';
  if (!remote && !search?.medical) return false;
  const domains: ReadonlyArray<
    readonly [
      SettingsConsentDomain,
      boolean,
      string,
      string,
      string,
      readonly SettingsConsentPermission[],
    ]
  > = [
    ...(remote
      ? [
          [
            'model',
            true,
            selected.providerId,
            selected.modelId,
            recipient,
            settingsPermissionsForFeature(slot, selected.providerId),
          ] as const,
        ]
      : []),
    ...(slot === 'conversation'
      ? [
          [
            'public-web',
            Boolean(search?.web),
            selected.providerId,
            selected.modelId,
            t('externalMedicalEvidence.publicSearchRecipient', { recipient }),
            [publicSearchSettingsPermissions.web],
          ] as const,
          [
            'medical-search',
            Boolean(search?.medical),
            'europe-pmc',
            'public-medical-search',
            'Europe PMC',
            [publicSearchSettingsPermissions.medical],
          ] as const,
        ]
      : []),
  ];
  let positive = 0;
  const witnesses: (() => boolean)[] = [];
  let epoch: SettingsConsentIdentity | undefined;
  try {
    for (const [
      domain,
      included,
      providerId,
      modelId,
      destination,
      expected,
    ] of domains) {
      const owner = await services.resolveTarget(slot, domain, {
        ...{ providerId, modelId },
        recipient: destination,
        selected,
        signal,
      });
      if (!current()) return false;
      if (!owner) {
        if (included) return false;
        continue;
      }
      if (
        owner.slot !== slot ||
        owner.domain !== domain ||
        !owner.isCurrent() ||
        owner.identity.providerId !== providerId ||
        owner.identity.modelId !== modelId ||
        owner.identity.recipient !== destination ||
        (epoch &&
          (epoch.authorityGeneration !== owner.identity.authorityGeneration ||
            epoch.credentialEpoch !== owner.identity.credentialEpoch))
      )
        return false;
      epoch ??= owner.identity;
      witnesses.push(owner.isCurrent);
      const row = parseSettingsConsentGrant(
        await services.readGrant(slot, domain),
      );
      if (!current() || !owner.isCurrent()) return false;
      const matching = row && equalIdentity(row.identity, owner.identity);
      if (!included) {
        if (matching) return false;
      } else {
        if (
          !matching ||
          row.catalogVersion !== SETTINGS_CONSENT_CATALOG_VERSION ||
          !row.permissions.every(permission =>
            isCatalogDomainPermission(slot, domain, permission, providerId),
          ) ||
          !exactSet(row.permissions, expected)
        )
          return false;
        positive++;
      }
    }
    return positive > 0 && current() && witnesses.every(witness => witness());
  } catch {
    return false;
  }
}
