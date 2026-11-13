import { useSyncExternalStore } from 'react';
import type { ConversationSessions } from './conversationSessionTypes';

/** The session owner keeps selection alive when this particular screen unmounts. */
export function useConversationPhotoControls(
  store: ConversationSessions,
  id: number,
) {
  const drafts = store.photoDrafts;
  const photo = useSyncExternalStore(drafts.subscribe, () => drafts.get(id));
  return {
    status: photo.status,
    ...('photo' in photo && photo.photo?.previewData
      ? { previewData: photo.photo.previewData }
      : {}),
    hasPhoto: 'photo' in photo && Boolean(photo.photo),
    ...('reason' in photo && photo.reason ? { errorReason: photo.reason } : {}),
    pickerDisabled: drafts.isPicking(),
    cleanupPending: drafts.cleanupPending(id),
    onRetryCleanup: () => {
      drafts.retryCleanup(id).catch(() => {});
    },
    onSelect: () => {
      drafts.select(id).catch(() => {});
    },
    onRemove: () => {
      drafts.remove(id).catch(() => {});
    },
  };
}
