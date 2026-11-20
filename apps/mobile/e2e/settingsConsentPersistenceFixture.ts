import { settingsConsentRecipient } from '../src/agent/execution/settingsConsentRecipient';
import type { saveModelSettingsConsent } from '../src/agent/execution/saveModelSettingsConsent';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import type { SqlDatabase } from '@orot/storage';
import {
  createConsentAuthority,
  type ConsentAuthorityPersistence,
} from '../src/agent/execution/consentAuthority';
import { createConsentGeneration } from '../src/agent/execution/consentGeneration';
import { commitSettingsConsent } from '../src/agent/execution/commitSettingsConsent';
import { createSettingsConsentAuthorization } from '../src/agent/execution/settingsConsentAuthorization';
import {
  settingsPermissionsForFeature,
  SETTINGS_CONSENT_CATALOG_VERSION,
} from '../src/agent/execution/settingsConsentCatalog';
import {
  createSettingsConsentStorage,
  type SettingsConsentSlot,
} from '../src/storage/settingsConsentStorage';
import type { ProviderSelectionStore } from '../src/providers/selection/types';

const slots = ['conversation', 'calendar', 'voice'] as const;
export const consentFixtureDestinations = {
  conversation: {
    providerId: 'chatgpt-plan:synthetic-consent:synthetic-model',
    modelId: 'synthetic-model',
    recipient: settingsConsentRecipient(
      'chatgpt-plan:synthetic-consent:synthetic-model',
    )!,
  },
  calendar: {
    providerId: 'openai-api-decisions',
    modelId: 'gpt-6-luna',
    recipient: 'OpenAI API',
  },
  voice: {
    providerId: 'openai-realtime',
    modelId: 'gpt-realtime-2.1-mini',
    recipient: 'OpenAI Realtime API',
  },
};

/** Exercise real coordinator/storage/authorization with synthetic identities only.
 * Native hosts supply isolated Keychain and SQLCipher; no provider is ever invoked. */
export function createSettingsConsentPersistenceFixture(input: {
  database: SqlDatabase;
  authority(slot: SettingsConsentSlot): ConsentAuthorityPersistence;
  selection(slot: SettingsConsentSlot): ProviderSelectionStore;
  generation?: () => string;
  credentialEpoch?: (slot: SettingsConsentSlot) => Promise<string | null>;
}) {
  const grants = createSettingsConsentStorage(input.database);
  const owners = Object.fromEntries(
    slots.map(slot => [
      slot,
      createConsentAuthority(
        input.authority(slot),
        input.generation ?? createConsentGeneration,
      ),
    ]),
  ) as Record<SettingsConsentSlot, ReturnType<typeof createConsentAuthority>>;
  const credentialEpoch =
    input.credentialEpoch ??
    (async (slot: SettingsConsentSlot) => `synthetic-${slot}-credential`);
  const identity = (
    slot: SettingsConsentSlot,
    generation: string,
    epoch: string,
  ) => ({
    ...consentFixtureDestinations[slot],
    authorityGeneration: generation,
    credentialEpoch: epoch,
  });
  const authorizationServices = (
    slot: SettingsConsentSlot,
  ): Parameters<typeof createSettingsConsentAuthorization>[0] => {
    return {
      catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
      readGrant: (selectedSlot, domain) => grants.read(selectedSlot, domain),
      async resolveOwner() {
        const authority = await owners[slot].current();
        const epoch = await credentialEpoch(slot);
        const selected = await input.selection(slot).load();
        const expected = consentFixtureDestinations[slot];
        if (
          !authority ||
          !epoch ||
          selected?.providerId !== expected.providerId ||
          selected.modelId !== expected.modelId
        )
          return null;
        return {
          slot,
          domain: 'model',
          identity: identity(slot, authority.generation, epoch),
          isCurrent: owners[slot].witness(authority.generation),
          subscribeInvalidation: listener => owners[slot].subscribe(listener),
        };
      },
    };
  };
  const authorization = (slot: SettingsConsentSlot) =>
    createSettingsConsentAuthorization(authorizationServices(slot));
  const inspect = async () => {
    const observations: Record<string, string> = {};
    for (const slot of slots) {
      const permission = settingsPermissionsForFeature(slot)[0];
      if (!permission) throw new Error('Synthetic permission missing');
      const signal = new AbortController().signal;
      const outbound: OutboundProcessingRequest = {
        ...consentFixtureDestinations[slot],
        operationRunId: `synthetic-${slot}`,
        remoteProcessing: true,
        consentScope: {
          purpose: permission.purpose,
          policyVersion: permission.policyVersion,
          dataCategories: permission.dataCategories,
        },
        allowedScope: { sourceKinds: ['personal_record'] },
        payload: {
          messages: [
            { role: 'user', content: 'Synthetic consent verification' },
          ],
        },
        signal,
      };
      const port = authorization(slot);
      observations[slot] = await port.authorize(outbound);
    }
    return {
      synthetic: true,
      providerExecution: 'not-configured',
      observations,
    };
  };
  const saveConsent: typeof saveModelSettingsConsent = async decision => {
    const slot = decision.slot;
    if (!slots.includes(slot)) throw new Error('Invalid synthetic slot');
    const selection = decision.store;
    const chosen = consentFixtureDestinations[slot];
    if (
      !decision.remote ||
      decision.selection.providerId !== chosen.providerId ||
      decision.selection.modelId !== chosen.modelId ||
      decision.recipient !== chosen.recipient ||
      decision.search?.web ||
      decision.search?.medical
    )
      throw new Error('Unsupported synthetic UI selection');
    const epoch = await credentialEpoch(slot);
    if (!epoch) throw new Error('Synthetic credential unavailable');
    const previous = await selection.load();
    const matches = async (expected: typeof previous) => {
      const value = await selection.load();
      return (
        value?.providerId === expected?.providerId &&
        value?.modelId === expected?.modelId
      );
    };
    await commitSettingsConsent({
      slot,
      authority: owners[slot],
      grants,
      makeGrant: generation => ({
        version: 1,
        catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
        identity: identity(slot, generation, epoch),
        permissions: settingsPermissionsForFeature(slot),
      }),
      saveSelection: () => selection.save(chosen),
      isSelectionCurrent: () => matches(chosen),
      isPreviousSelectionCurrent: () => matches(previous),
      isCredentialCurrent: async () => (await credentialEpoch(slot)) === epoch,
      isRequestCurrent: decision.isCurrent,
      signal: decision.signal,
    });
  };
  return {
    authorization,
    authorizationServices,
    inspect,
    saveConsent,
    async approve(slot: SettingsConsentSlot) {
      await saveConsent({
        slot,
        store: input.selection(slot),
        selection: consentFixtureDestinations[slot],
        recipient: consentFixtureDestinations[slot].recipient,
        remote: true,
        isCurrent: () => true,
        signal: new AbortController().signal,
      });
      return inspect();
    },
    async revoke(retainSqlRows = false) {
      for (const slot of slots) await owners[slot].revoke();
      // Deliberate retained rows model a failed SQL cleanup after durable tombstones.
      if (!retainSqlRows) await grants.clear();
      return inspect();
    },
  };
}
