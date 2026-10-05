import type { AppleAvailabilityStatus } from '@orot/provider-apple';
import type { ChatGPTPlanModelDescriptor } from '@orot/provider-openai';
import { appleFoundationModelsProvider } from '../apple';
import { createOpenAIPlanProvider } from '../openai';
import { providerSelectionText } from './text';
import type { ProviderSelectionOption } from './types';

// The visit recommendation request is text based and may call local record tools.
// It does not use schema output or model token streaming for provider execution.
export const visitRecommendationRequirements = {
  inputTypes: ['text'],
  toolCalling: true,
} as const;

export const APPLE_FOUNDATION_MODEL_SELECTION_ID =
  'apple-foundation-models-system-default';

export function createAppleSelectionOption(
  status: AppleAvailabilityStatus,
): ProviderSelectionOption {
  const unavailableMessage = appleUnavailableMessage(status);
  // Apple exposes the system-selected model as one choice, not a versioned catalog.
  return {
    provider: appleFoundationModelsProvider,
    modelId: APPLE_FOUNDATION_MODEL_SELECTION_ID,
    displayName: 'Apple Intelligence',
    privacyBoundary: 'on-device',
    availability:
      unavailableMessage === null
        ? { status: 'available' }
        : { status: 'unavailable', message: unavailableMessage },
  };
}

export async function loadAppleSelectionOption(): Promise<ProviderSelectionOption> {
  try {
    const availability = await appleFoundationModelsProvider.getAvailability();
    return createAppleSelectionOption(availability.status);
  } catch {
    return {
      provider: appleFoundationModelsProvider,
      modelId: APPLE_FOUNDATION_MODEL_SELECTION_ID,
      displayName: 'Apple Intelligence',
      privacyBoundary: 'on-device',
      availability: {
        status: 'unavailable',
        message: providerSelectionText.appleStatusError,
      },
    };
  }
}

export function createChatGPTSelectionOptions(
  issuedClientID: string,
  models: readonly ChatGPTPlanModelDescriptor[],
): readonly ProviderSelectionOption[] {
  if (
    !issuedClientID.trim() ||
    issuedClientID !== issuedClientID.trim() ||
    issuedClientID.length > 1024
  ) {
    throw new Error(providerSelectionText.chatGPTAccountRequired);
  }

  // The catalog has no per-model feature metadata, so use the adapter's declared capabilities.
  return models.map(model => ({
    provider: createOpenAIPlanProvider(issuedClientID, model),
    modelId: model.slug,
    displayName: model.displayName,
    privacyBoundary: 'selected-context-remote',
    availability: { status: 'available' },
  }));
}

function appleUnavailableMessage(
  status: AppleAvailabilityStatus,
): string | null {
  switch (status) {
    case 'available':
      return null;
    case 'disabled':
      return providerSelectionText.appleDisabled;
    case 'modelNotReady':
      return providerSelectionText.appleModelNotReady;
    case 'unsupportedDevice':
      return providerSelectionText.appleUnsupportedDevice;
    case 'unsupportedLanguage':
      return providerSelectionText.appleUnsupportedLanguage;
  }
}
