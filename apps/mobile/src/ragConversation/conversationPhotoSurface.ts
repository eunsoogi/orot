import type { ConversationSessionOptions } from './conversationSessionTypes';
import { createConversationPhotoImport } from './conversationPhotoImport';
import { createConversationPhotoConsentController } from './conversationPhotoConsentController';

/** Expose the existing photo ownership surface without duplicating consent or delivery policy. */
export function conversationPhotoSurface(options: ConversationSessionOptions) {
  return {
    photoDrafts: createConversationPhotoImport(),
    photoConsent: createConversationPhotoConsentController(),
    photoRetirement: options.photoPreparation?.retirement,
    photoDeliveryAvailable: Boolean(
      options.photoPreparation && options.retention,
    ),
  };
}
