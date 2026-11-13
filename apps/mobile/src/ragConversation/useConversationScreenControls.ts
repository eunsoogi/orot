import type { ConversationSessions } from './conversationSessions';
import { useReplyFocusForSession } from '../replyNotifications/replyFocus';
import { useConversationPhotoControls } from './useConversationPhotoControls';
import { createElement } from 'react';
import { ConversationVoiceEntry } from '../voiceConversation/ConversationVoiceEntry';
import type { ConversationScreenProps } from './ConversationScreenProps';

/** Keep session-owned attachment and reply focus controls bound to the visible session. */
export function useConversationScreenControls(
  store: ConversationSessions,
  id: number,
  isEntryCurrent?: () => boolean,
  voiceSelection?: ConversationScreenProps['voiceSelection'],
  busy?: boolean,
  onSend?: ConversationScreenProps['onSend'],
) {
  const photo = useConversationPhotoControls(store, id);
  return {
    photo,
    focus: useReplyFocusForSession(id, isEntryCurrent),
    voice:
      voiceSelection && onSend
        ? createElement(ConversationVoiceEntry, {
            key: id,
            store,
            sessionId: id,
            busy: Boolean(busy),
            photoPending:
              photo.status !== 'empty' || Boolean(photo.cleanupPending),
            isEntryCurrent,
            selectionRevision: voiceSelection.revision,
            resolveSelectedAi: voiceSelection.resolve,
            onSend,
          })
        : undefined,
  };
}
