import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { createSettingsConsentAuthorization } from '../agent/execution/settingsConsentAuthorization';
import { productionSettingsConsentReadServices } from '../agent/execution/SettingsConsentReadServices';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../agent/execution/settingsConsentCatalog';
import {
  directPhotoConsentScope,
  directPhotoScopePayload,
  legacyDirectPhotoConsentScope,
  legacyDirectPhotoScopePayload,
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
    imageCount = 1,
  ) => {
    if (
      signal.aborted ||
      !selected.remoteProcessing ||
      ![1, 2, 3].includes(imageCount)
    )
      return null;
    const requestFor = (legacy: boolean): OutboundProcessingRequest =>
      Object.freeze({
        operationRunId: operationRunId(),
        providerId: selected.provider.id,
        modelId: selected.modelId,
        recipient: selected.recipient,
        remoteProcessing: true,
        consentScope: legacy
          ? legacyDirectPhotoConsentScope
          : directPhotoConsentScope,
        allowedScope: unsetImages,
        payload: legacy
          ? legacyDirectPhotoScopePayload
          : directPhotoScopePayload,
        signal,
      });
    let request = requestFor(false);
    const approved = async (value: OutboundProcessingRequest) =>
      (await consent.authorize(value)) === 'authorized' &&
      consent.isAuthorizationCurrent?.(value) === true;
    if (!(await approved(request))) {
      // Only the unchanged single-image route may use the old exact grant.
      if (signal.aborted || imageCount !== 1) return null;
      request = requestFor(true);
      if (!(await approved(request))) return null;
    }
    return {
      current: () => consent.isAuthorizationCurrent?.(request) === true,
      subscribe: (listener: () => void) =>
        consent.subscribeAuthorizationInvalidation!(request, listener),
    };
  };
}
