import { stableJson } from '../../aiFeatures/integration/evidenceUtils';
import { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import { settingsConsentAuthority } from '../../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import { canReuseConsent, consentRevision } from './consentRevision';
import { settingsConsentCredential } from './settingsConsentCredential';
import { settingsConsentRecipient } from './settingsConsentRecipient';
import { parseSettingsConsentGrant } from './settingsConsentGrant';
import {
  isCatalogDomainPermission,
  SETTINGS_CONSENT_CATALOG_VERSION,
} from './settingsConsentCatalog';

/** Fixed protected stores, no provider resolution or authorization side effects. */
export async function readDailyReportWarmSettingsOwner(
  providerId: string,
  modelId: string,
  expectedRecipient: string,
  signal: AbortSignal,
) {
  try {
    const selectedCurrent = providerSelectionStore.liveWitness();
    const revision = consentRevision();
    const selected = () =>
      !signal.aborted &&
      canReuseConsent() &&
      consentRevision() === revision &&
      selectedCurrent?.() === true;
    if (!selected()) return null;
    const selection = await providerSelectionStore.load();
    const recipient = settingsConsentRecipient(providerId);
    if (
      !selected() ||
      !selection ||
      selection.providerId !== providerId ||
      selection.modelId !== modelId ||
      !recipient ||
      recipient !== expectedRecipient
    )
      return null;
    const credential = await settingsConsentCredential(providerId, false);
    if (!selected() || !credential || !credential.isCurrent()) return null;
    const authority = settingsConsentAuthority('conversation');
    const state = await authority.current();
    if (!selected() || !credential.isCurrent() || !state) return null;
    const authorityCurrent = authority.witness(state.generation);
    const isCurrent = () =>
      selected() && credential.isCurrent() && authorityCurrent();
    if (!isCurrent()) return null;
    const repository = await settingsConsentRepository();
    const grant = parseSettingsConsentGrant(
      await repository.read('conversation', 'model'),
    );
    const identity = {
      ...selection,
      recipient,
      authorityGeneration: state.generation,
      credentialEpoch: credential.epoch,
    };
    if (
      !isCurrent() ||
      !grant ||
      grant.catalogVersion !== SETTINGS_CONSENT_CATALOG_VERSION ||
      stableJson(grant.identity) !== stableJson(identity) ||
      !grant.permissions.every(p =>
        isCatalogDomainPermission('conversation', 'model', p),
      )
    )
      return null;
    const permission = grant.permissions.find(
      p =>
        p.purpose === 'daily_report' &&
        p.policyVersion === 'daily-report-analysis-v2' &&
        p.dataCategories.includes('health_records') &&
        p.sourceKinds.includes('personal_record'),
    );
    return permission && isCurrent()
      ? {
          isCurrent,
          identity: stableJson([identity, permission, grant.catalogVersion]),
        }
      : null;
  } catch {
    return null;
  }
}
