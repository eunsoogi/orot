import { commitSettingsConsent } from '../agent/execution/commitSettingsConsent';
import {
  canReuseConsent,
  consentRevision,
} from '../agent/execution/consentRevision';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../agent/execution/settingsConsentCatalog';
import { settingsConsentAuthority } from '../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../storage/settingsConsentRepository';
import {
  isLiveResponsesBackend,
  type LiveResponsesBackend,
  liveResponsesPermissions,
  liveResponsesProviderId,
  liveResponsesRecipient,
  liveResponsesSlot,
} from './liveResponsesSettingsIdentity';
import {
  apiCredentialMutation,
  voiceSelectionMutation,
} from './voiceConsentIdentity';
import {
  binding,
  readBinding,
  sameBinding,
  writeBinding,
  type DeviceBinding,
  type NativeLiveResponsesGrant,
} from './liveResponsesSettingsBinding';
import { voiceSettingsStore } from './voiceSettingsStore';

const authority = () => settingsConsentAuthority(liveResponsesSlot);
const audioAuthority = () => settingsConsentAuthority('voice');

export type { NativeLiveResponsesGrant } from './liveResponsesSettingsBinding';
function captureOwner() {
  const key = apiCredentialMutation.capture();
  const selection = voiceSelectionMutation.capture();
  const reset = consentRevision();
  return () =>
    key?.() === true &&
    selection?.() === true &&
    canReuseConsent() &&
    consentRevision() === reset;
}

export type LiveResponsesSettings =
  | { readonly kind: 'off' | 'unavailable' }
  | {
      readonly kind: 'active';
      readonly nativeGrant: NativeLiveResponsesGrant;
      readonly credentialEpoch: string;
      readonly current: () => boolean;
      readonly subscribe: (listener: () => void) => () => void;
    };

/** Positive SQL permission, exact nonmigrating binding and device credential must
 * agree. Missing versus unreadable is distinct, so an opted-in call cannot
 * silently change processing path after an authority or account failure. */
export async function loadLiveResponsesSettings(
  expectedCredentialEpoch?: string,
): Promise<LiveResponsesSettings> {
  try {
    const owned = captureOwner();
    if (!owned()) return { kind: 'unavailable' };
    const state = await authority().reviewState();
    if (!owned() || !state) return { kind: 'unavailable' };
    if (state.kind === 'revoked')
      return state.current() ? { kind: 'off' } : { kind: 'unavailable' };
    if (state.kind === 'unset') {
      const prior = await readBinding();
      return owned() && state.current() && !prior
        ? { kind: 'off' }
        : { kind: 'unavailable' };
    }
    if (state.kind !== 'active') return { kind: 'unavailable' };
    const audio = await audioAuthority().current();
    if (!audio) return { kind: 'unavailable' };
    const audioCurrent = audioAuthority().witness(audio.generation);
    const credential = (await voiceSettingsStore.liveCredentials())
      .credentialEpoch;
    if (
      expectedCredentialEpoch !== undefined &&
      credential !== expectedCredentialEpoch
    )
      return { kind: 'unavailable' };
    const metadata = await readBinding();
    if (!metadata) return { kind: 'unavailable' };
    const expected = binding(
      state.generation,
      credential,
      metadata.backendModel,
    );
    const store = await settingsConsentRepository();
    const grant = await store.read(liveResponsesSlot);
    const current = () => owned() && state.current() && audioCurrent();
    if (
      !current() ||
      !sameBinding(expected, metadata) ||
      !grant ||
      grant.catalogVersion !== SETTINGS_CONSENT_CATALOG_VERSION ||
      grant.identity.providerId !== liveResponsesProviderId ||
      grant.identity.modelId !== expected.backendModel ||
      grant.identity.recipient !== liveResponsesRecipient ||
      grant.identity.authorityGeneration !== expected.generation ||
      grant.identity.credentialEpoch !== credential ||
      JSON.stringify(grant.permissions) !==
        JSON.stringify(liveResponsesPermissions)
    )
      return { kind: 'unavailable' };
    const after = await voiceSettingsStore.liveCredentials();
    if (!current() || after.credentialEpoch !== credential)
      return { kind: 'unavailable' };
    return {
      kind: 'active',
      credentialEpoch: credential,
      nativeGrant: Object.freeze({
        backendModel: expected.backendModel,
        grantID: expected.grantID,
        generation: expected.generation,
      }),
      current,
      subscribe(listener) {
        const stops = [
          authority().subscribe(listener),
          audioAuthority().subscribe(listener),
          apiCredentialMutation.subscribe(listener),
          voiceSelectionMutation.subscribe(listener),
        ];
        if (!current()) listener();
        return () => stops.forEach(stop => stop());
      },
    };
  } catch {
    return { kind: 'unavailable' };
  }
}

/** Call exclusively after the real Settings disclosure has returned Allow. No
 * legacy migration, secondary account, fallback or provider request is made. */
export async function saveLiveResponsesSettings(input: {
  readonly backendModel: LiveResponsesBackend;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly audioCurrent: () => boolean;
}): Promise<void> {
  if (!isLiveResponsesBackend(input.backendModel))
    throw new Error('Unsupported backend');
  const owned = captureOwner();
  const current = () =>
    owned() &&
    !input.signal.aborted &&
    input.isCurrent() &&
    input.audioCurrent();
  if (!current()) throw new Error('Live Responses decision unavailable');
  const epoch = (await voiceSettingsStore.liveCredentials()).credentialEpoch;
  const sameAccount = async () =>
    current() &&
    (await voiceSettingsStore.liveCredentials()).credentialEpoch === epoch &&
    current();
  const grants = await settingsConsentRepository();
  if (!current()) throw new Error('Live Responses decision unavailable');
  let selected: DeviceBinding | null = null;
  await commitSettingsConsent({
    slot: liveResponsesSlot,
    authority: authority(),
    grants,
    makeGrant(generation) {
      selected = binding(generation, epoch, input.backendModel);
      return {
        version: 1,
        catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
        identity: {
          providerId: liveResponsesProviderId,
          modelId: input.backendModel,
          recipient: liveResponsesRecipient,
          credentialEpoch: epoch,
          authorityGeneration: generation,
        },
        permissions: liveResponsesPermissions,
      };
    },
    async saveSelection() {
      if (!selected || !current())
        throw new Error('Live Responses decision unavailable');
      await writeBinding(selected);
      if (!current()) throw new Error('Live Responses binding unavailable');
    },
    isSelectionCurrent: async () =>
      selected !== null &&
      sameBinding(selected, await readBinding()) &&
      current(),
    // A replacement may already have overwritten the device binding. Never
    // revive a previous generation from this decision's failed/cancelled write.
    isPreviousSelectionCurrent: async () => false,
    isCredentialCurrent: sameAccount,
    isRequestCurrent: current,
    signal: input.signal,
  });
}

/** Revoke synchronously in-process, then persist the device tombstone. A
 * failed durable write remains an error; it is never shown as successfully off. */
export async function revokeLiveResponsesSettings(): Promise<void> {
  await authority().revoke();
}
