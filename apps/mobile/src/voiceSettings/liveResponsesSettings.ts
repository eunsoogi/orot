import type { Preferences } from './liveVoicePreferences';
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
  liveResponsesAggregateV2Permissions,
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
  type DeviceBinding,
  type NativeLiveResponsesGrant,
} from './liveResponsesSettingsBinding';
import { voiceSettingsStore } from './voiceSettingsStore';
import {
  liveAggregateDevicePolicy,
  stageLiveAggregateSettingsBinding,
  liveAggregateSettingsBindingMatches,
} from './liveAggregateDeviceWitness';
import {
  takeReviewedLiveResponsesAggregate,
  type ReviewedLiveResponsesAggregate,
} from './reviewLiveResponsesAggregate';
import { liveResponsesActivePolicy } from './liveResponsesActivePolicy';
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
      /** Only an exact committed pair carries saved preferences for display. */
      readonly savedPreferences?: Preferences;
      /** The v1 receipt is still displayable, but never authorizes headless health. */
      readonly aggregatePolicy?: 'headless-v2';
      readonly commonToolsPolicy?: 'common-tools-v3';
      readonly current: () => boolean;
      readonly subscribe: (listener: () => void) => () => void;
    };

/** Positive SQL permission, exact nonmigrating binding and device credential must
 * agree. Missing versus unreadable is distinct, so an opted-in call cannot
 * silently change processing path after an authority or account failure. */
export async function loadLiveResponsesSettings(
  expectedCredentialEpoch?: string,
  purpose?: 'tool-reproof' | 'settings-presentation',
): Promise<LiveResponsesSettings> {
  try {
    const owned = captureOwner();
    if (!owned()) return { kind: 'unavailable' };
    // The current challenge may overlap metadata reads; both receipts still reprove.
    const loadPair = () => voiceSettingsStore.loadCommittedVoicePair?.();
    const readState = () => authority().reviewState();
    const [pair, state] =
      purpose === 'tool-reproof'
        ? await Promise.all([loadPair(), readState()])
        : ([await loadPair(), await readState()] as const);
    if (!owned() || !state || (purpose === 'tool-reproof' && !state.current()))
      return { kind: 'unavailable' };
    if (state.kind === 'revoked')
      return !pair && state.current()
        ? { kind: 'off' }
        : { kind: 'unavailable' };
    if (state.kind === 'unset') {
      if (pair) return { kind: 'unavailable' };
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
    if (
      pair &&
      (pair.pair.voiceGeneration !== audio.generation ||
        pair.pair.responsesGeneration !== state.generation ||
        pair.pair.credentialEpoch !== credential)
    )
      return { kind: 'unavailable' };
    const metadata = pair
      ? binding(state.generation, credential, pair.pair.backendModel)
      : await readBinding();
    if (!metadata) return { kind: 'unavailable' };
    const expected = binding(
      state.generation,
      credential,
      metadata.backendModel,
    );
    const store = await settingsConsentRepository();
    const grant = await store.read(liveResponsesSlot);
    const current = () => owned() && state.current() && audioCurrent();
    if (!current() || !sameBinding(expected, metadata))
      return { kind: 'unavailable' };
    const permission = await liveResponsesActivePolicy(
      grant,
      expected,
      pair?.pair.voiceGeneration,
    );
    if (!permission || !current()) return { kind: 'unavailable' };
    const headless = permission !== 'interactive-v1';
    const after = await voiceSettingsStore.liveCredentials();
    if (!current() || after.credentialEpoch !== credential)
      return { kind: 'unavailable' };
    return {
      kind: 'active',
      ...(headless ? { aggregatePolicy: 'headless-v2' as const } : {}),
      ...(permission === 'common-tools-v3'
        ? { commonToolsPolicy: permission }
        : {}),
      credentialEpoch: credential,
      ...(purpose === 'settings-presentation' && pair
        ? { savedPreferences: pair.preferences }
        : {}),
      nativeGrant: Object.freeze({
        ...(headless ? { scope: liveAggregateDevicePolicy } : {}),
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
  readonly reviewedAggregate: ReviewedLiveResponsesAggregate;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly audioCurrent: () => boolean;
}): Promise<void> {
  if (!isLiveResponsesBackend(input.backendModel))
    throw new Error('Unsupported backend');
  const reviewed = takeReviewedLiveResponsesAggregate(
    input.reviewedAggregate,
    input.backendModel,
    input.signal,
  );
  if (!reviewed || reviewed.commonTools)
    throw new Error('Fresh Live aggregate settings review required');
  const owned = captureOwner();
  const current = () =>
    reviewed() &&
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
        permissions: liveResponsesAggregateV2Permissions,
      };
    },
    async saveSelection() {
      if (!selected || !current())
        throw new Error('Live Responses decision unavailable');
      await stageLiveAggregateSettingsBinding(selected);
      if (!current()) throw new Error('Live Responses binding unavailable');
    },
    isSelectionCurrent: async () =>
      selected !== null &&
      (await liveAggregateSettingsBindingMatches(selected)) &&
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
