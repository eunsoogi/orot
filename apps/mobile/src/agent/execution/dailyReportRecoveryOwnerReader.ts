import {
  captureDailyReportRecoveryScope,
  type DailyReportRecoveryScope,
} from './dailyReportRecoveryScope';
import type { providerSelectionStore } from '../../providers/selection/keychainSelectionStore';
import type { settingsConsentAuthority } from '../../storage/settingsConsentAuthority';
import type { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import type { settingsConsentCredential } from './settingsConsentCredential';
import { settingsConsentRecipient } from './settingsConsentRecipient';
import { parseSettingsConsentGrant } from './settingsConsentGrant';
import {
  isCatalogDomainPermission,
  SETTINGS_CONSENT_CATALOG_VERSION,
} from './settingsConsentCatalog';
import { parseDailyRecoveryCandidate } from '../../storage/dailyReportRecoveryCandidate';
import { validateDailyReportSave } from '../../storage/dailyReportLineage';
import type { DailyReportRecoveryWitness } from '../../storage/dailyReportRecoveryWitness';
import { stableJson } from '../../aiFeatures/integration/evidenceUtils';
import { canReuseConsent, consentRevision } from './consentRevision';

/** Explicit protected-store ownership; no resolver or authorize capability is accepted.
 * Production binds its fixed stores; isolated native tests bind only their UUID stores. */
export function createDailyReportRecoveryOwnerReader(ports: {
  providerSelectionStore: Pick<
    typeof providerSelectionStore,
    'load' | 'liveWitness' | 'subscribeChanges'
  >;
  settingsConsentAuthority: typeof settingsConsentAuthority;
  settingsConsentRepository: typeof settingsConsentRepository;
  settingsConsentCredential: typeof settingsConsentCredential;
}) {
  /** Read-only authority for saving an already validated result, never permission to
   * transmit. No provider resolution, authorization, credential initialization or UI.
   * Local selections have no durable committed-local-selection receipt/API: do not infer one from
   * a provider ID or revive an old candidate after selecting away and restarting. */
  return async function readDailyReportRecoveryOwner(
    value: unknown,
    signal: AbortSignal,
    scope: DailyReportRecoveryScope,
  ): Promise<(DailyReportRecoveryWitness & { dispose(): void }) | null> {
    let scopeCurrent: ReturnType<typeof captureDailyReportRecoveryScope> = null;
    let issued = false;
    try {
      const candidate = parseDailyRecoveryCandidate(value);
      if (!candidate) return null;
      const context = validateDailyReportSave(candidate)!.context;
      scopeCurrent = captureDailyReportRecoveryScope(
        context,
        candidate.runId,
        scope,
        signal,
      );
      if (!scopeCurrent) return null;
      const selectedCurrent = ports.providerSelectionStore.liveWitness();
      const revision = consentRevision();
      const currentSelection = () =>
        !signal.aborted &&
        scopeCurrent?.isCurrent() === true &&
        canReuseConsent() &&
        consentRevision() === revision &&
        selectedCurrent?.() === true;
      if (!currentSelection()) return null;
      const selection = await ports.providerSelectionStore.load();
      if (
        !currentSelection() ||
        !selection ||
        selection.providerId !== context.provider.providerId ||
        selection.modelId !== context.provider.modelId
      )
        return null;
      const recipient = settingsConsentRecipient(selection.providerId);
      if (!recipient) return null;
      const credential = await ports.settingsConsentCredential(
        selection.providerId,
        false,
      );
      if (!currentSelection() || !credential || !credential.isCurrent())
        return null;
      const authority = ports.settingsConsentAuthority('conversation');
      const state = await authority.current();
      if (!currentSelection() || !credential.isCurrent() || !state) return null;
      const authorityCurrent = authority.witness(state.generation);
      const current = () => {
        try {
          return (
            currentSelection() &&
            credential.isCurrent() === true &&
            authorityCurrent() === true
          );
        } catch {
          return false;
        }
      };
      const repository = await ports.settingsConsentRepository();
      if (!current()) return null;
      const grant = parseSettingsConsentGrant(
        await repository.read('conversation', 'model'),
      );
      if (
        !current() ||
        !grant ||
        grant.catalogVersion !== SETTINGS_CONSENT_CATALOG_VERSION ||
        !grant.permissions.every(p =>
          isCatalogDomainPermission('conversation', 'model', p),
        )
      )
        return null;
      const identity = {
        ...selection,
        recipient,
        authorityGeneration: state.generation,
        credentialEpoch: credential.epoch,
      };
      if (stableJson(grant.identity) !== stableJson(identity)) return null;
      const policyVersion = context.systemCalendar
        ? 'daily-report-calendar-analysis-v2'
        : 'daily-report-analysis-v2';
      const categories = context.systemCalendar
        ? ['health_records', 'calendar_plans']
        : ['health_records'];
      const permission = grant.permissions.find(
        p =>
          p.purpose === 'daily_report' &&
          p.policyVersion === policyVersion &&
          categories.every(c => p.dataCategories.includes(c)) &&
          p.sourceKinds.includes('personal_record'),
      );
      if (!permission || !current()) return null;
      issued = true;
      return {
        identity: {
          key: context.identity.key,
          providerId: selection.providerId,
          modelId: selection.modelId,
          authorizationRevision: stableJson({
            identity,
            requestScope: scopeCurrent.identity,
            catalogVersion: grant.catalogVersion,
            permission,
          }),
        },
        isCurrent: current,
        // The consumer releases its capture in finally, even if it never stages/resumes.
        dispose: scopeCurrent.dispose,
        subscribeInvalidation(listener) {
          const check = () => {
            if (!current()) listener();
          };
          const a = ports.providerSelectionStore.subscribeChanges(check);
          const b = authority.subscribe(check);
          const c = credential.subscribe(check);
          const d = scopeCurrent!.subscribeInvalidation(check);
          signal.addEventListener('abort', check, { once: true });
          check();
          return () => {
            a();
            b();
            c();
            d();
            signal.removeEventListener('abort', check);
          };
        },
      };
    } catch {
      // Operational failures and incomplete/malformed durable records are not authority.
      return null;
    } finally {
      // Failed lookup owns no live lease; successful witnesses live only until request abort/replacement.
      if (!issued) scopeCurrent?.dispose();
    }
  };
}
