import { retireAcceptedPhotoPresentation } from './acceptedPhotoPresentation';
import type { ConversationSessionOptions } from './conversationSessionTypes';
import { createConversationDirectPhotoRetention } from './conversationDirectPhotoRetention';
import { createDirectPhotoDraftOwner } from './directPhotoDraftOwner';
import { createConversationPhotoImport } from './conversationPhotoImport';
import { createConversationPhotoConsentController } from './conversationPhotoConsentController';

/** Expose the existing photo ownership surface without duplicating consent or delivery policy. */
export function conversationPhotoSurface(
  options: ConversationSessionOptions,
  activeId: () => number | false,
) {
  const surface = {
    directPhotoDrafts: createDirectPhotoDraftOwner(activeId),
    photoDrafts: createConversationPhotoImport(),
    photoConsent: createConversationPhotoConsentController(),
    photoRetirement: options.photoPreparation?.retirement,
    photoDeliveryAvailable: Boolean(
      options.photoPreparation && options.retention,
    ),
  };
  return {
    ...surface,
    clear(dispose = false) {
      retireAcceptedPhotoPresentation(surface.directPhotoDrafts);
      surface.photoConsent.dispose();
      surface.photoDrafts.clear().catch(() => {});
      if (dispose) surface.directPhotoDrafts.dispose();
      else surface.directPhotoDrafts.retire();
    },
    retain(
      find: Parameters<
        typeof createConversationDirectPhotoRetention
      >[1]['find'],
      update: Parameters<
        typeof createConversationDirectPhotoRetention
      >[1]['update'],
      nextId: () => number,
    ) {
      // Expose only the public photo controls; the local writer still binds the active session.
      return {
        ...surface,
        retainDirectPhoto: createConversationDirectPhotoRetention(
          options,
          { find, update, nextId },
          id => activeId() === id,
        ),
      };
    },
  };
}
