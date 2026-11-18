import { createRecordRepository, type SqlDatabase } from '@orot/storage';
import { createConsentGeneration } from '../src/agent/execution/consentGeneration';
import { createConsentAuthority } from '../src/agent/execution/consentAuthority';
import { createCredentialMutationOwner } from '../src/agent/execution/credentialMutation';
import { commitSettingsConsent } from '../src/agent/execution/commitSettingsConsent';
import { createDailyReportRecoveryOwnerReader } from '../src/agent/execution/dailyReportRecoveryOwnerReader';
import {
  SETTINGS_CONSENT_CATALOG_VERSION,
  settingsPermissionsForFeature,
} from '../src/agent/execution/settingsConsentCatalog';
import { createSettingsConsentStorage } from '../src/storage/settingsConsentStorage';
import { createDailyReportLocalRecovery } from '../src/storage/dailyReportLocalRecovery';
import { readDailyReportPending } from '../src/storage/dailyReportPendingRead';
import { createDailyReportStorage } from '../src/storage/dailyReportStorage';
import { createDailyReportCalendarWindow } from '../src/healthEvidence/healthContext/dailyReportWindow';
import { createNativeDailyRecoveryCandidate } from './dailyRecoveryNativeCandidate';
import type { openSettingsConsentNativeStore } from './settingsConsentNativeStore';

/** Native-only synthetic ownership: the same read-only owner and storage implementation,
 * but UUID-scoped protected stores. There is no provider or authorize port to invoke. */
export function createDailyRecoveryNativeSession(
  store: Pick<
    Awaited<ReturnType<typeof openSettingsConsentNativeStore>>,
    'authority' | 'selection' | 'recoveryCredential'
  > & { database: SqlDatabase },
) {
  const authority = createConsentAuthority(
    store.authority('conversation'),
    createConsentGeneration,
  );
  const grants = createSettingsConsentStorage(store.database);
  const selection = store.selection('conversation');
  const lifetime = createCredentialMutationOwner();
  const expected = {
    providerId: 'openai-api-decisions',
    modelId: 'synthetic-model',
  };
  const window = createDailyReportCalendarWindow({
    localDate: '2035-01-01',
    timeZone: 'UTC',
    requestedAt: '2035-01-01T12:00:00Z',
  });
  if (window.status !== 'ready')
    throw new Error('Synthetic request window invalid');
  const scope = {
    current: () => ({
      ownerId: 'daily-report:synthetic-recovery-run',
      runId: 'synthetic-recovery-run',
      window: window.context,
    }),
    subscribeChanges: (listener: () => void) => lifetime.subscribe(listener),
  };
  const reader = createDailyReportRecoveryOwnerReader({
    providerSelectionStore: {
      ...selection,
      liveWitness: () => lifetime.capture(),
      subscribeChanges: listener => lifetime.subscribe(listener),
    },
    settingsConsentAuthority: () => authority,
    settingsConsentRepository: async () => grants,
    settingsConsentCredential: async (id, initialize) => {
      if (initialize || id !== expected.providerId)
        throw new Error(
          'Synthetic credential initialization forbidden during recovery',
        );
      const epoch = await store.recoveryCredential.read();
      return typeof epoch === 'string'
        ? {
            epoch,
            isCurrent: lifetime.capture()!,
            subscribe: listener => lifetime.subscribe(listener),
          }
        : null;
    },
  });
  const recovery = createDailyReportLocalRecovery(store.database);
  const signal = new AbortController().signal;
  const inspect = async () => {
    const pending = await readDailyReportPending(
      store.database,
      window.context.identity.key,
    );
    const saved = await createDailyReportStorage(store.database).lookup(
      window.context.identity,
    );
    // Only closed metadata crosses the native test broker, never report text or source IDs.
    return {
      synthetic: true,
      providerExecution: 'not-configured',
      authorizationExecution: 'not-configured',
      pendingCount: pending.length,
      savedStatus: saved.status,
      savedRevision: 'revision' in saved ? saved.revision : null,
    };
  };
  return {
    inspect,
    async stage() {
      const candidate = await createNativeDailyRecoveryCandidate(
        store.database,
      );
      await store.recoveryCredential.write('synthetic-recovery-epoch');
      await commitSettingsConsent({
        slot: 'conversation',
        authority,
        grants,
        makeGrant: generation => ({
          version: 1,
          catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
          identity: {
            ...expected,
            recipient: 'OpenAI API',
            authorityGeneration: generation,
            credentialEpoch: 'synthetic-recovery-epoch',
          },
          permissions: settingsPermissionsForFeature('conversation'),
        }),
        saveSelection: () => selection.save(expected),
        isSelectionCurrent: async () =>
          (await selection.load())?.modelId === expected.modelId,
        isPreviousSelectionCurrent: async () => true,
        isCredentialCurrent: async () => true,
        isRequestCurrent: () => true,
        signal,
      });
      const owner = await reader(candidate, signal, scope);
      if (!owner) throw new Error('Synthetic protected owner unavailable');
      try {
        return {
          ...(await recovery.stage(candidate, owner, signal)),
          ...(await inspect()),
        };
      } finally {
        owner.dispose();
      }
    },
    async resume() {
      const [candidate] = await readDailyReportPending(
        store.database,
        window.context.identity.key,
      );
      if (!candidate) return { status: 'unavailable', ...(await inspect()) };
      const owner = await reader(candidate, signal, scope);
      if (!owner) return { status: 'unavailable', ...(await inspect()) };
      try {
        return {
          status: (await recovery.resume(candidate.runId, owner, signal))
            .status,
          ...(await inspect()),
        };
      } finally {
        owner.dispose();
      }
    },
    async invalidate(kind: 'cancel' | 'delete' | 'revoke') {
      if (kind === 'cancel') await recovery.cancel('synthetic-recovery-run');
      else if (kind === 'revoke') await authority.revoke();
      else
        await createRecordRepository(store.database).delete(
          'health_observation',
          'synthetic-report-source',
        );
      return { ...(await inspect()), invalidated: kind };
    },
  };
}
