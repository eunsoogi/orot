import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { appleFoundationModelsNativeBridge } from './nativeBridge';

export const appleFoundationModelsProvider = new AppleFoundationModelsProvider(
  appleFoundationModelsNativeBridge,
);

export {
  appleAvailabilityMessage,
  appleGenerationFailureMessage,
} from './availabilityMessage';
