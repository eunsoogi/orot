import type { ConversationSessions } from './conversationSessions';
import { useReplyFocusForSession } from '../replyNotifications/replyFocus';
import { useConversationPhotoControls } from './useConversationPhotoControls';

/** Keep session-owned attachment and reply focus controls bound to the visible session. */
export function useConversationScreenControls(
  store: ConversationSessions,
  id: number,
  isEntryCurrent?: () => boolean,
) {
  return {
    photo: useConversationPhotoControls(store, id),
    focus: useReplyFocusForSession(id, isEntryCurrent),
  };
}
