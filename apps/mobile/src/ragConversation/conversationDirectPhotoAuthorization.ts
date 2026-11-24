import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { createSettingsConsentAuthorization } from '../agent/execution/settingsConsentAuthorization';
import { productionSettingsConsentReadServices } from '../agent/execution/SettingsConsentReadServices';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../agent/execution/settingsConsentCatalog';
import {
  directPhotoConsentScope,
  directPhotoScopePayload,
} from '../agent/execution/directPhotoConsentScope';
import { operationRunId } from '../aiFeatures/integration/featureRunIdentity';
import type { SelectedAiResolution } from '../aiFeatures/integration/provider';

const unsetImages = Object.freeze({ sourceKinds: Object.freeze([]) });
/** The stored grant checks purpose, never raw pixels. The composer owns the
 * immutable image/prompt pair and checks that same owner before actual dispatch. */
export function createDirectPhotoSettingsAuthorization(
  services = productionSettingsConsentReadServices,
) {
  const consent = createSettingsConsentAuthorization({
    ...services,
    catalogVersion: SETTINGS_CONSENT_CATALOG_VERSION,
  });
  return async (
    selected: Extract<SelectedAiResolution, { status: 'ready' }>,
    signal: AbortSignal,
  ) => {
    if (signal.aborted || !selected.remoteProcessing) return null;
    const request: OutboundProcessingRequest = Object.freeze({
      operationRunId: operationRunId(),
      providerId: selected.provider.id,
      modelId: selected.modelId,
      recipient: selected.recipient,
      remoteProcessing: true,
      consentScope: directPhotoConsentScope,
      allowedScope: unsetImages,
      payload: directPhotoScopePayload,
      signal,
    });
    if (
      (await consent.authorize(request)) !== 'authorized' ||
      consent.isAuthorizationCurrent?.(request) !== true
    )
      return null;
    return {
      current: () => consent.isAuthorizationCurrent?.(request) === true,
      subscribe: (listener: () => void) =>
        consent.subscribeAuthorizationInvalidation!(request, listener),
    };
  };
}
