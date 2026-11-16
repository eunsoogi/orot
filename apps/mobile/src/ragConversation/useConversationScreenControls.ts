import { immediateConversationChoices } from './immediateConversationChoices';
import type { ConversationSessions } from './conversationSessions';
import { useReplyFocusForSession } from '../replyNotifications/replyFocus';
import { useConversationPhotoControls } from './useConversationPhotoControls';
import { createElement, useCallback, useState } from 'react';
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
  retainedActions?: ConversationScreenProps['retainedActions'],
  prepareVisitQuestions?: ConversationScreenProps['prepareVisitQuestions'],
) {
  const photo = useConversationPhotoControls(store, id);
  const [voiceMessage, setVoiceMessage] = useState({
    sessionId: id,
    status: '',
  });
  const onVoiceStatusChange = useCallback(
    (status: string) => setVoiceMessage({ sessionId: id, status }),
    [id],
  );
  return {
    quickChoices: onSend
      ? immediateConversationChoices(
          store,
          id,
          retainedActions,
          onSend,
          prepareVisitQuestions,
          isEntryCurrent,
        )
      : retainedActions,
    photo,
    status:
      voiceSelection && onSend && voiceMessage.sessionId === id
        ? voiceMessage.status
        : '',
    focus: useReplyFocusForSession(id, isEntryCurrent),
    trailingAction:
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
            confirmRealtimeResult: voiceSelection.confirmRealtimeResult,
            onSend,
            onStatusChange: onVoiceStatusChange,
          })
        : undefined,
  };
}
