import { createSettingsConsentAuthorization } from '../agent/execution/settingsConsentAuthorization';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../agent/execution/settingsConsentCatalog';
import { settingsConsentRepository } from '../storage/settingsConsentRepository';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import {
  loadLiveResponsesSettings,
  type LiveResponsesSettings,
} from './liveResponsesSettings';
import {
  liveResponsesPermissionVersion,
  liveResponsesProviderId,
  liveResponsesRecipient,
  liveResponsesSlot,
} from './liveResponsesSettingsIdentity';

type ActiveSelection = Extract<LiveResponsesSettings, { kind: 'active' }>;

/** Verify the same selected account, model and persisted permissions twice using
 * Conversation's request/payload witness. The tool binder still owns named tool
 * admission, operation-specific consent, protection/source proof and send. */
export function liveConversationToolsAuthorization(
  selection: ActiveSelection,
  callCurrent: () => boolean,
) {
  const gate = createSettingsConsentAuthorization({
    catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
    async resolveOwner(request) {
      if (!current(request)) return null;
      const latest = await loadLiveResponsesSettings(
        selection.credentialEpoch,
        'tool-reproof',
      );
      if (
        latest.kind !== 'active' ||
        latest.commonToolsPolicy !== 'common-tools-v3' ||
        latest.nativeGrant.generation !== selection.nativeGrant.generation ||
        latest.nativeGrant.grantID !== selection.nativeGrant.grantID ||
        latest.nativeGrant.backendModel !==
          selection.nativeGrant.backendModel ||
        !latest.current() ||
        !current(request)
      )
        return null;
      return {
        slot: liveResponsesSlot,
        domain: 'model',
        identity: {
          providerId: liveResponsesProviderId,
          recipient: liveResponsesRecipient,
          modelId: selection.nativeGrant.backendModel,
          authorityGeneration: selection.nativeGrant.generation,
          credentialEpoch: selection.credentialEpoch,
        },
        isCurrent: () => current(request) && latest.current(),
        subscribeInvalidation: latest.subscribe,
      };
    },
    async readGrant(slot, domain) {
      if (slot !== liveResponsesSlot || domain !== 'model') return null;
      const grant = await (
        await settingsConsentRepository()
      ).read(slot, domain);
      return grant &&
        liveResponsesPermissionVersion(grant.permissions) === 'common-tools-v3'
        ? grant
        : null;
    },
  });
  const current = (request: OutboundProcessingRequest) => {
    try {
      return (
        request.remoteProcessing === true &&
        request.consentScope?.purpose === 'record_conversation' &&
        request.providerId === liveResponsesProviderId &&
        request.modelId === selection.nativeGrant.backendModel &&
        request.recipient === liveResponsesRecipient &&
        !request.signal.aborted &&
        selection.commonToolsPolicy === 'common-tools-v3' &&
        selection.current() === true &&
        callCurrent() === true
      );
    } catch {
      return false;
    }
  };
  return {
    ...gate,
    authorize: (request: OutboundProcessingRequest) =>
      current(request)
        ? gate.authorize(request)
        : Promise.resolve('renewal_required' as const),
    isAuthorizationCurrent: (request: OutboundProcessingRequest) =>
      current(request) && gate.isAuthorizationCurrent?.(request) === true,
  };
}
