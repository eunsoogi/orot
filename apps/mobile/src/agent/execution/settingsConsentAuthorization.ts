import {
  isCatalogDomainPermission,
  SETTINGS_CONSENT_CATALOG_VERSION,
} from './settingsConsentCatalog';
import type {
  ExecutionConsentPort,
  OutboundProcessingRequest,
} from '@orot/agent-runtime';
import { consentSnapshot } from './consentSnapshot';
import { canReuseConsent, consentRevision } from './consentRevision';
import {
  settingsGrantCoversRequest,
  type SettingsConsentGrant,
  type SettingsConsentIdentity,
} from './settingsConsentGrant';
import type {
  SettingsConsentDomain,
  SettingsConsentSlot,
} from '../../storage/settingsConsentStorage';

export interface SettingsConsentOwner {
  readonly slot: SettingsConsentSlot;
  readonly domain: SettingsConsentDomain;
  readonly identity: SettingsConsentIdentity;
  readonly isCurrent: () => boolean;
  readonly subscribeInvalidation?: (listener: () => void) => () => void;
}
const sameOwner = (a: SettingsConsentOwner, b: SettingsConsentOwner | null) =>
  b !== null &&
  a.slot === b.slot &&
  a.domain === b.domain &&
  a.identity.providerId === b.identity.providerId &&
  a.identity.modelId === b.identity.modelId &&
  a.identity.recipient === b.identity.recipient &&
  a.identity.authorityGeneration === b.identity.authorityGeneration &&
  a.identity.credentialEpoch === b.identity.credentialEpoch;

/** No prompt or cached execution verdict: each remote call rechecks its settings owner,
 * durable permission and exact payload. Source/deletion validation remains upstream.
 * The resolver must return null for pending/suspended/legacy or unavailable accounts. */
export function createSettingsConsentAuthorization(input: {
  readonly catalogVersion: string;
  readonly resolveOwner: (
    request: OutboundProcessingRequest,
  ) => Promise<SettingsConsentOwner | null>;
  readonly readGrant: (
    slot: SettingsConsentSlot,
    domain: SettingsConsentDomain,
  ) => Promise<SettingsConsentGrant | null>;
}): ExecutionConsentPort {
  const witnesses = new WeakMap<OutboundProcessingRequest, () => boolean>();
  const subscriptions = new WeakMap<
    OutboundProcessingRequest,
    (listener: () => void) => () => void
  >();
  return {
    subscribeAuthorizationInvalidation(request, listener) {
      if (!request.remoteProcessing) return () => {};
      const subscribe = subscriptions.get(request);
      if (!subscribe || witnesses.get(request)?.() !== true) {
        listener();
        return () => {};
      }
      const stop = subscribe(listener);
      if (witnesses.get(request)?.() !== true) listener();
      return stop;
    },
    isAuthorizationCurrent(request) {
      if (!request.remoteProcessing) return !request.signal.aborted;
      try {
        return witnesses.get(request)?.() === true;
      } catch {
        return false;
      }
    },
    async authorize(request) {
      if (!request.remoteProcessing) return 'authorized';
      witnesses.delete(request);
      subscriptions.delete(request);
      const snapshot = consentSnapshot(request);
      const revision = consentRevision();
      const current = () =>
        Boolean(snapshot) &&
        !request.signal.aborted &&
        canReuseConsent() &&
        consentRevision() === revision &&
        consentSnapshot(request) === snapshot;
      if (!current()) return 'renewal_required';
      try {
        const owner = await input.resolveOwner(request);
        if (!owner || !current()) return 'renewal_required';
        // Copy primitives before awaiting; a mutable resolver result cannot alter this owner.
        const captured: SettingsConsentOwner = {
          slot: owner.slot,
          domain: owner.domain,
          identity: { ...owner.identity },
          isCurrent: owner.isCurrent,
          subscribeInvalidation: owner.subscribeInvalidation,
        };
        const grant = await input.readGrant(captured.slot, captured.domain);
        if (
          !grant ||
          input.catalogVersion !== SETTINGS_CONSENT_CATALOG_VERSION ||
          !grant.permissions.every(permission =>
            isCatalogDomainPermission(
              captured.slot,
              captured.domain,
              permission,
            ),
          ) ||
          !current() ||
          !settingsGrantCoversRequest(
            grant,
            captured.identity,
            input.catalogVersion,
            request,
          )
        )
          return 'renewal_required';
        const after = await input.resolveOwner(request);
        if (
          !current() ||
          !sameOwner(captured, after) ||
          !after ||
          !captured.isCurrent() ||
          !after.isCurrent()
        )
          return 'renewal_required';
        witnesses.set(
          request,
          () => current() && captured.isCurrent() && after.isCurrent(),
        );
        subscriptions.set(request, listener => {
          const check = () => {
            if (witnesses.get(request)?.() !== true) listener();
          };
          const a = captured.subscribeInvalidation?.(check) ?? (() => {});
          const b = after.subscribeInvalidation?.(check) ?? (() => {});
          return () => {
            a();
            b();
          };
        });
        return 'authorized';
      } catch {
        // Storage/credential errors are not approval and never trigger a chat fallback modal.
        return 'renewal_required';
      }
    },
  };
}
