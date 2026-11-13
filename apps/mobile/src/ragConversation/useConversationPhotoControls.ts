import { useSyncExternalStore } from 'react';
import type { ConversationSessions } from './conversationSessionTypes';

/** The session owner keeps selection alive when this particular screen unmounts. */
export function useConversationPhotoControls(
  store: ConversationSessions,
  id: number,
) {
  const drafts = store.photoDrafts;
  const photo = useSyncExternalStore(drafts.subscribe, () => drafts.get(id));
  const pickerDisabled = useSyncExternalStore(
    drafts.subscribe,
    drafts.isPicking,
  );
  const cleanupPending = useSyncExternalStore(
    drafts.subscribe,
    () => drafts.failedCleanupSessionIds().length > 0,
  );
  return {
    status: photo.status,
    ...('photo' in photo && photo.photo?.previewData
      ? { previewData: photo.photo.previewData }
      : {}),
    hasPhoto: 'photo' in photo && Boolean(photo.photo),
    ...('reason' in photo && photo.reason ? { errorReason: photo.reason } : {}),
    pickerDisabled,
    cleanupPending,
    onRetryCleanup: () => {
      Promise.allSettled(
        drafts.failedCleanupSessionIds().map(drafts.retryCleanup),
      ).catch(() => {});
    },
    onSelect: () => {
      drafts.select(id).catch(() => {});
    },
    onRemove: () => {
      drafts.remove(id).catch(() => {});
    },
  };
}
