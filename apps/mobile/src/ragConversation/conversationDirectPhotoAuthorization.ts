import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { createSettingsConsentAuthorization } from '../agent/execution/settingsConsentAuthorization';
import { productionSettingsConsentReadServices } from '../agent/execution/SettingsConsentReadServices';
import { SETTINGS_CONSENT_CATALOG_VERSION } from '../agent/execution/settingsConsentCatalog';
import {
  directPhotoConsentScope,
  directPhotoScopePayload,
  legacyDirectPhotoConsentScope,
  legacyDirectPhotoScopePayload,
  previousGroupDirectPhotoConsentScope,
  previousGroupDirectPhotoScopePayload,
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
    const requestFor = (
      consentScope: OutboundProcessingRequest['consentScope'],
      payload: OutboundProcessingRequest['payload'],
    ): OutboundProcessingRequest =>
      Object.freeze({
        operationRunId: operationRunId(),
        providerId: selected.provider.id,
        modelId: selected.modelId,
        recipient: selected.recipient,
        remoteProcessing: true,
        consentScope,
        allowedScope: unsetImages,
        payload,
        signal,
      });
    let request = requestFor(directPhotoConsentScope, directPhotoScopePayload);
    let retainAuthoredCaption: true | undefined = true;
    const approved = async (value: OutboundProcessingRequest) =>
      (await consent.authorize(value)) === 'authorized' &&
      consent.isAuthorizationCurrent?.(value) === true;
    if (!(await approved(request))) {
      // Existing grants keep their original transfer; only the newly
      // disclosed policy allows the question to be put in protected history.
      retainAuthoredCaption = undefined;
      if (signal.aborted) return null;
      request = requestFor(
        previousGroupDirectPhotoConsentScope,
        previousGroupDirectPhotoScopePayload,
      );
      if (!(await approved(request))) {
        if (signal.aborted || imageCount !== 1) return null;
        request = requestFor(
          legacyDirectPhotoConsentScope,
          legacyDirectPhotoScopePayload,
        );
        if (!(await approved(request))) return null;
      }
    }
    return {
      ...(retainAuthoredCaption ? { retainAuthoredCaption } : {}),
      current: () => consent.isAuthorizationCurrent?.(request) === true,
      subscribe: (listener: () => void) =>
        consent.subscribeAuthorizationInvalidation!(request, listener),
    };
  };
}
