import { useSyncExternalStore } from 'react';
import { ConversationPhotoConsent } from './ConversationPhotoConsent';
import type { createConversationPhotoConsentController } from './conversationPhotoConsentController';

/** A presentation may unmount while the session owner retains the pending decision. */
export function ConversationPhotoConsentSurface({
  controller,
}: {
  readonly controller: ReturnType<
    typeof createConversationPhotoConsentController
  >;
}) {
  const details = useSyncExternalStore(controller.subscribe, controller.get);
  if (!details) return null;
  return (
    <ConversationPhotoConsent
      visible
      {...details}
      onApprove={() => controller.answer(true)}
      onCancel={() => controller.answer(false)}
    />
  );
}
