import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import {
  appleFoundationModelsNativeBridge,
  appleRecapNativeBridge,
  applePrivateCloudComputeNativeBridge,
} from './nativeBridge';

export const appleFoundationModelsProvider = new AppleFoundationModelsProvider(
  appleFoundationModelsNativeBridge,
);

export const applePrivateCloudComputeProvider =
  new AppleFoundationModelsProvider(
    applePrivateCloudComputeNativeBridge,
    'private-cloud-compute',
  );

/** The selected Apple identity remains unchanged while Recap uses a text-only transformation. */
export function appleRecapProvider() {
  const provider = new AppleFoundationModelsProvider(appleRecapNativeBridge);
  return {
    id: provider.id,
    kind: provider.kind,
    displayName: provider.displayName,
    capabilities: {
      ...provider.capabilities,
      streaming: false,
      structuredOutput: false,
      toolCalling: false,
    },
    generate: provider.generate.bind(provider),
  };
}

export {
  appleAvailabilityMessage,
  appleGenerationFailureMessage,
} from './availabilityMessage';
