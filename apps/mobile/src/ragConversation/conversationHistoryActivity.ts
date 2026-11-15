import type { DisplayMessage } from './ConversationMessage';
import type { ConversationActivitySnapshot } from './conversationActivity';
import type { ConversationSession } from './conversationSessionTypes';

/** Hides empty assistant placeholders while preserving the keyed partial response. */
export function conversationHistoryActivity(
  messages: readonly DisplayMessage[],
  pending: ConversationSession['pendingMessage'],
  requestSessionId: number | undefined,
  requestActivity: ConversationActivitySnapshot | null | undefined,
  separatedActivity = false,
) {
  // The producer uses the pending response ID as the request ID; reject stale turns.
  const activity =
    requestActivity &&
    requestActivity.sessionId === requestSessionId &&
    requestActivity.requestId === pending?.id
      ? requestActivity
      : null;
  const hasPendingContent = Boolean(
    pending?.initialResponse ||
    pending?.content.trim() ||
    pending?.toolEvents?.length,
  );
  // Cold Continue replaces its interrupted bubble visually, not in retained data.
  const settled = pending
    ? messages.filter(message => message.id !== pending.id)
    : messages;
  const visibleMessages =
    !pending || (activity && !hasPendingContent)
      ? settled
      : [
          ...settled,
          {
            ...pending,
            activity: activity ? undefined : pending.activity,
            role: 'assistant' as const,
            streaming: true,
          },
        ];
  // Expanded Duo hides partial answer text, but must still show request progress.
  const showActivityBubble = Boolean(
    activity &&
    (separatedActivity ||
      activity.stage !== 'streaming' ||
      !pending?.content.trim()),
  );

  return { visibleMessages, showActivityBubble };
}
