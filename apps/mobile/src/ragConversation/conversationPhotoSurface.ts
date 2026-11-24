import type { ConversationSessionOptions } from './conversationSessionTypes';
import { createConversationDirectPhotoRetention } from './conversationDirectPhotoRetention';
import { createConversationPhotoImport } from './conversationPhotoImport';
import { createConversationPhotoConsentController } from './conversationPhotoConsentController';

/** Expose the existing photo ownership surface without duplicating consent or delivery policy. */
export function conversationPhotoSurface(options: ConversationSessionOptions) {
  const surface = {
    photoDrafts: createConversationPhotoImport(),
    photoConsent: createConversationPhotoConsentController(),
    photoRetirement: options.photoPreparation?.retirement,
    photoDeliveryAvailable: Boolean(
      options.photoPreparation && options.retention,
    ),
  };
  return {
    ...surface,
    retain(
      restoration: {
        readonly publishDirectPhoto: Parameters<
          typeof createConversationDirectPhotoRetention
        >[1];
      },
      activeId: () => number | false,
    ) {
      // Expose only the public photo controls; the local writer still binds the active session.
      return {
        ...surface,
        retainDirectPhoto: createConversationDirectPhotoRetention(
          options,
          restoration.publishDirectPhoto,
          id => activeId() === id,
        ),
      };
    },
  };
}
