import {
  settingsSearchGrants,
  type SettingsSearchChoices,
} from './settingsSearchGrants';
import type {
  ProviderSelection,
  ProviderSelectionStore,
} from '../../providers/selection/types';
import type { SettingsConsentSlot } from '../../storage/settingsConsentStorage';
import { settingsConsentAuthority } from '../../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../../storage/settingsConsentRepository';
import { settingsConsentCredential } from './settingsConsentCredential';
import { commitSettingsConsent } from './commitSettingsConsent';
import {
  SETTINGS_CONSENT_CATALOG_VERSION,
  settingsPermissionsForFeature,
} from './settingsConsentCatalog';

const same = (a: ProviderSelection | null, b: ProviderSelection | null) =>
  a?.providerId === b?.providerId && a?.modelId === b?.modelId;

/** This boundary is called only by the explicit settings confirmation, after its
 * recipient/data/continuing-use disclosure. Saving a choice alone is never approval. */
export async function saveModelSettingsConsent(input: {
  slot: SettingsConsentSlot;
  search?: SettingsSearchChoices;
  selection: ProviderSelection;
  recipient: string;
  remote: boolean;
  store: ProviderSelectionStore;
  signal: AbortSignal;
  isCurrent: () => boolean;
}) {
  const authority = settingsConsentAuthority(input.slot);
  const prior = await input.store.load();
  if (input.signal.aborted || !input.isCurrent())
    throw new Error('Settings decision cancelled');
  if (
    !input.remote &&
    !(input.slot === 'conversation' && input.search?.medical)
  ) {
    const previousAuthority = await authority.current();
    const previousCredential = prior
      ? await settingsConsentCredential(prior.providerId)
      : null;
    // A local choice leaves the external authority suspended, including across restart.
    const suspension = await authority.suspend();
    try {
      if (input.signal.aborted || !input.isCurrent())
        throw new Error('Settings decision cancelled');
      await input.store.save(input.selection);
    } catch (error) {
      if (previousAuthority && previousCredential) {
        await authority
          .restore(
            suspension,
            previousAuthority,
            async () =>
              previousCredential.isCurrent() &&
              same(await input.store.load(), prior),
          )
          .catch(() => false);
      }
      throw error;
    }
    return;
  }
  const credential = await settingsConsentCredential(
    input.selection.providerId,
    true,
  );
  if (!credential || !credential.isCurrent())
    throw new Error('Account permission identity unavailable');
  const grants = await settingsConsentRepository();
  await commitSettingsConsent({
    slot: input.slot,
    authority,
    grants,
    makeGrant: generation => ({
      version: 1,
      catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
      identity: {
        ...input.selection,
        recipient: input.recipient,
        authorityGeneration: generation,
        credentialEpoch: credential.epoch,
      },
      permissions: settingsPermissionsForFeature(input.slot),
    }),
    additionalGrants: generation =>
      input.slot === 'conversation'
        ? settingsSearchGrants(
            {
              ...input.selection,
              recipient: input.recipient,
              authorityGeneration: generation,
              credentialEpoch: credential.epoch,
            },
            input.search,
          )
        : [],
    saveSelection: () => input.store.save(input.selection),
    isSelectionCurrent: async () =>
      same(await input.store.load(), input.selection),
    isPreviousSelectionCurrent: async () =>
      same(await input.store.load(), prior),
    isCredentialCurrent: async () => {
      const value = await settingsConsentCredential(input.selection.providerId);
      return Boolean(
        value &&
        value.epoch === credential.epoch &&
        value.isCurrent() &&
        credential.isCurrent(),
      );
    },
    isRequestCurrent: input.isCurrent,
    signal: input.signal,
  });
}
