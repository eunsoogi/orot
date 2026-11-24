import { commitSettingsConsent } from '../agent/execution/commitSettingsConsent';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../agent/execution/settingsConsentCatalog';
import { settingsConsentAuthority } from '../storage/settingsConsentAuthority';
import { settingsConsentRepository } from '../storage/settingsConsentRepository';
import {
  liveResponsesProviderId,
  liveResponsesRecipient,
} from './liveResponsesSettingsIdentity';
import { loadLiveResponsesSettings, type LiveResponsesSettings } from './liveResponsesSettings';
import {
  canonicalHealthBinding,
  canonicalHealthPolicy,
  canonicalHealthSlot,
  readCanonicalHealthBinding,
  writeCanonicalHealthBinding,
  type CanonicalHealthBinding,
} from './liveCanonicalHealthBinding';

const authority = () => settingsConsentAuthority(canonicalHealthSlot);
export const canonicalHealthPermission = {
  purpose: 'live_responses_canonical_health_context',
  policyVersion: canonicalHealthPolicy,
  dataCategories: ['health_records'],
  sourceKinds: ['personal_record'],
} as const;

const matches = (
  left: CanonicalHealthBinding,
  right: CanonicalHealthBinding | undefined,
) =>
  !!right &&
  left.version === right.version &&
  left.capability === right.capability &&
  left.generation === right.generation &&
  left.grantID === right.grantID &&
  left.legacyGeneration === right.legacyGeneration &&
  left.credentialEpoch === right.credentialEpoch &&
  left.backendModel === right.backendModel;

type Base = Extract<LiveResponsesSettings, { kind: 'active' }>;
type Companion = NonNullable<Awaited<ReturnType<typeof loadActiveCompanion>>>;

async function loadActiveCompanion(
  base: Base,
  owned: ReturnType<typeof authority>,
  expectedGeneration: string,
) {
  const active = await owned.current();
  if (!active || active.generation !== expectedGeneration || !base.current()) return;
  const fence = owned.witness(active.generation);
  const current = () => base.current() && fence();
  const expected = canonicalHealthBinding(
    active.generation,
    base.nativeGrant,
    base.credentialEpoch,
  );
  if (!matches(expected, await readCanonicalHealthBinding()) || !current())
    return;
  const store = await settingsConsentRepository();
  const grant = await store.read(canonicalHealthSlot);
  if (
    !grant ||
    !current() ||
    grant.catalogVersion !== SETTINGS_CONSENT_CATALOG_VERSION ||
    grant.identity.providerId !== liveResponsesProviderId ||
    grant.identity.recipient !== liveResponsesRecipient ||
    grant.identity.modelId !== expected.backendModel ||
    grant.identity.credentialEpoch !== expected.credentialEpoch ||
    grant.identity.authorityGeneration !== expected.generation ||
    JSON.stringify(grant.permissions) !==
      JSON.stringify([canonicalHealthPermission])
  )
    return;
  return {
    binding: expected,
    current,
    subscribe(listener: () => void) {
      const baseline = base.subscribe(listener);
      const dedicated = authority().subscribe(listener);
      return () => {
        dedicated();
        baseline();
      };
    },
  };
}

/** One latched account, never reinterpret a read failure as a saved choice. */
export async function readCanonicalLiveHealthStartup(base: Base): Promise<
  | { kind: 'off'; current: () => boolean }
  | { kind: 'active'; companion: Companion }
  | { kind: 'unavailable' }
> {
  try {
    if (!base.current()) return { kind: 'unavailable' };
    const owned = authority();
    const state = await owned.reviewState();
    if (!state || !state.current() || !base.current()) return { kind: 'unavailable' };
    const current = () => state.current() && base.current();
    if (state.kind === 'revoked') return { kind: 'off', current };
    if (state.kind === 'unset') {
      const row = await readCanonicalHealthBinding();
      if (row || !current()) return { kind: 'unavailable' };
      const store = await settingsConsentRepository();
      const review = await store.readReviewGrant(canonicalHealthSlot, 'model');
      // Malformed or duplicated SQL rows are unreadable, not absent.
      return review.status === 'unset' && current() ? { kind: 'off', current } : { kind: 'unavailable' };
    }
    if (state.kind !== 'active') return { kind: 'unavailable' };
    const companion = await loadActiveCompanion(base, owned, state.generation);
    return companion?.current() && current()
      ? { kind: 'active', companion }
      : { kind: 'unavailable' };
  } catch {
    return { kind: 'unavailable' };
  }
}

export async function loadCanonicalLiveHealthSettings() {
  try {
    const base = await loadLiveResponsesSettings();
    if (base.kind !== 'active') return;
    const startup = await readCanonicalLiveHealthStartup(base);
    return startup.kind === 'active' ? startup.companion : undefined;
  } catch {
    return undefined;
  }
}

/** Requires fresh explicit Settings approval. The ordinary aggregate grant is a
 * prerequisite, never proof that canonical health content was also approved. */
export async function saveCanonicalLiveHealthSettings(input: {
  readonly signal: AbortSignal;
  readonly current: () => boolean;
  readonly confirm: (
    review: Readonly<{
      providerId: typeof liveResponsesProviderId;
      recipient: typeof liveResponsesRecipient;
      model: string;
      policyVersion: typeof canonicalHealthPolicy;
    }>,
    signal: AbortSignal,
  ) => Promise<boolean>;
}) {
  const base = await loadLiveResponsesSettings();
  if (base.kind !== 'active')
    throw new Error('Live Responses consent is unavailable');
  const current = () =>
    !input.signal.aborted && input.current() && base.current();
  if (
    !current() ||
    !(await input.confirm(
      Object.freeze({
        providerId: liveResponsesProviderId,
        recipient: liveResponsesRecipient,
        model: base.nativeGrant.backendModel,
        policyVersion: canonicalHealthPolicy,
      }),
      input.signal,
    )) ||
    !current()
  )
    return false;
  const grants = await settingsConsentRepository();
  let binding: CanonicalHealthBinding | undefined;
  await commitSettingsConsent({
    slot: canonicalHealthSlot,
    authority: authority(),
    grants,
    makeGrant(generation) {
      binding = canonicalHealthBinding(
        generation,
        base.nativeGrant,
        base.credentialEpoch,
      );
      return {
        version: 1,
        catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
        identity: {
          providerId: liveResponsesProviderId,
          recipient: liveResponsesRecipient,
          modelId: base.nativeGrant.backendModel,
          authorityGeneration: generation,
          credentialEpoch: base.credentialEpoch,
        },
        permissions: [canonicalHealthPermission],
      };
    },
    async saveSelection() {
      if (!binding || !current())
        throw new Error('Canonical health selection retired');
      await writeCanonicalHealthBinding(binding);
    },
    isSelectionCurrent: async () =>
      !!binding &&
      matches(binding, await readCanonicalHealthBinding()) &&
      current(),
    isPreviousSelectionCurrent: async () => false,
    async isCredentialCurrent() {
      const next = await loadLiveResponsesSettings(base.credentialEpoch);
      return (
        next.kind === 'active' &&
        next.current() &&
        current() &&
        next.nativeGrant.generation === base.nativeGrant.generation &&
        next.nativeGrant.backendModel === base.nativeGrant.backendModel
      );
    },
    isRequestCurrent: current,
    signal: input.signal,
  });
  return true;
}

export async function revokeCanonicalLiveHealthSettings() {
  await authority().revoke();
}
/** An invalid or incomplete credential is not a saved Off decision. */
export async function readCanonicalLiveHealthChoice(backend: string) {
  try {
    const base = await loadLiveResponsesSettings();
    if (base.kind !== 'active' || base.nativeGrant.backendModel !== backend) return;
    const state = await readCanonicalLiveHealthStartup(base);
    if (state.kind === 'unavailable') return;
    return state.kind === 'off'
      ? { enabled: false as const, current: state.current, ownerCurrent: base.current }
      : { enabled: true as const, current: state.companion.current, ownerCurrent: base.current };
  } catch {
    return undefined;
  }
}
