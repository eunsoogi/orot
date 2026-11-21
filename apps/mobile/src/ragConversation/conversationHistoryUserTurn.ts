import { useLayoutEffect, useRef } from 'react';
import type { DisplayMessage } from './ConversationMessage';

type MutableRef<T> = { current: T };

/** Follow new local user turns without treating session changes or restored history as submissions. */
export function useConversationHistoryUserTurnFollow(
  sessionId: number | null,
  messages: readonly DisplayMessage[],
  followsBottom: MutableRef<boolean>,
  expectedOffset: MutableRef<number | null>,
) {
  const previousSessionId = useRef(sessionId);
  const messageIds = useRef(messages.map(message => message.id));

  useLayoutEffect(() => {
    const previousIds = messageIds.current;
    if (sessionId !== previousSessionId.current) {
      previousSessionId.current = sessionId;
      messageIds.current = messages.map(message => message.id);
      return;
    }
    const newSubmittedMessage = messages.some(
      message =>
        message.role === 'user' &&
        !message.localChoicePending &&
        message.id > 0 &&
        !previousIds.includes(message.id),
    );
    if (newSubmittedMessage) {
      // A quick preview preserves reading position through its same-ID receipt transition.
      followsBottom.current = true;
      expectedOffset.current = null;
    }
    messageIds.current = messages.map(message => message.id);
  }, [expectedOffset, followsBottom, messages, sessionId]);
}
