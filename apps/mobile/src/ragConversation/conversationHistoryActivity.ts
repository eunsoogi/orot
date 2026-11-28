import { useMemo } from 'react';
import {
  usePreviousConversationDisplay,
  type PreviousDisplayOwner,
} from './usePreviousConversationDisplay';
import { useConversationHistoryUserTurnFollow } from './conversationHistoryUserTurn';
import {
  savedHistoryTranscript,
  type SavedHistoryDisplayItem,
} from './conversationSavedHistoryDisplay';
import type { DisplayMessage } from './ConversationMessage';
import type { ConversationActivitySnapshot } from './conversationActivity';
import type { ConversationSession } from './conversationSessionTypes';
import { presentDirectPhotos } from './directPhotoPresentation';
import { useDirectPhotoPresentation } from './DirectPhotoPresentationScope';
import { parseConversationMessageDelivery } from './conversationMessageDelivery';

/** Hides empty assistant placeholders while preserving the keyed partial response. */
export function conversationHistoryActivity(
  messages: readonly DisplayMessage[],
  pending: ConversationSession['pendingMessage'],
  requestSessionId: number | undefined,
  requestActivity: ConversationActivitySnapshot | null | undefined,
  separatedActivity = false,
  showToolActivity = false,
) {
  // The producer uses the pending response ID as the request ID; reject stale turns.
  const activity =
    requestActivity &&
    requestActivity.sessionId === requestSessionId &&
    requestActivity.requestId === pending?.id
      ? requestActivity
      : null;
  const user =
    activity?.userMessageId === undefined
      ? undefined
      : messages.find(
          message =>
            message.role === 'user' && message.id === activity.userMessageId,
        );
  const read = Boolean(
    parseConversationMessageDelivery(user?.delivery)?.readAt,
  );
  // Keep genuine response text; only synthetic waiting surfaces require Read.
  const initialResponse =
    pending?.initialResponse?.source === 'receipt' && !read
      ? undefined
      : pending?.initialResponse;
  const layoutSkeleton =
    read &&
    activity &&
    !pending?.withholdHealthBody &&
    pending?.layoutSkeleton?.current()
      ? pending.layoutSkeleton.layout
      : undefined;
  const hasPendingContent = Boolean(
    pending?.previousOutputs?.length ||
    initialResponse ||
    pending?.content.trim() ||
    layoutSkeleton ||
    (read && showToolActivity && pending?.toolEvents?.length),
  );
  // Cold Continue replaces its interrupted bubble visually, not in retained data.
  const settled = pending
    ? messages.filter(message => message.id !== pending.id)
    : messages;
  const visibleMessages =
    !pending || !hasPendingContent
      ? settled
      : [
          ...settled,
          {
            ...pending,
            initialResponse,
            layoutSkeleton,
            activity: read && showToolActivity ? pending.activity : undefined,
            role: 'assistant' as const,
            streaming: true,
          },
        ];
  // Expanded Duo hides partial answer text, but must still show request progress.
  const showActivityBubble = Boolean(
    read &&
    activity &&
    (separatedActivity ||
      activity.stage !== 'streaming' ||
      !pending?.content.trim()),
  );

  return {
    visibleMessages,
    showActivityBubble,
    processing: Boolean(activity?.responseStarted),
  };
}

/** Follow-to-bottom observes live turns only. Old prose joins at render time. */
export function useConversationHistoryPresentation(input: {
  saved?: readonly SavedHistoryDisplayItem[];
  previousDisplayOwner?: PreviousDisplayOwner;
  steeringInstructions?: DisplayMessage['steeringInstructions'];
  messages: readonly DisplayMessage[];
  pendingMessage: ConversationSession['pendingMessage'];
  requestSessionId?: number;
  requestActivity?: ConversationActivitySnapshot | null;
  separatedActivity: boolean;
  sessionId?: number;
  followsBottom: Parameters<typeof useConversationHistoryUserTurnFollow>[2];
  expectedOffset: Parameters<typeof useConversationHistoryUserTurnFollow>[3];
}) {
  const { saved, messages } = input;
  const previous = usePreviousConversationDisplay(
    input.sessionId,
    input.previousDisplayOwner,
    saved !== undefined,
  );
  const directPhoto = useDirectPhotoPresentation();
  const transcript = useMemo(
    () =>
      presentDirectPhotos(
        [...previous, ...savedHistoryTranscript(saved ?? [], messages)],
        directPhoto,
        input.sessionId,
      ),
    [previous, saved, messages, directPhoto, input.sessionId],
  );
  useConversationHistoryUserTurnFollow(
    input.sessionId ?? null,
    messages,
    input.followsBottom,
    input.expectedOffset,
    input.pendingMessage &&
      input.pendingMessage.id === input.requestActivity?.requestId &&
      input.sessionId === input.requestActivity?.sessionId
      ? input.steeringInstructions?.find(row => row.submittedHere)?.id
      : undefined,
  );
  return conversationHistoryActivity(
    transcript,
    input.pendingMessage,
    input.requestSessionId,
    input.requestActivity,
    input.separatedActivity,
  );
}
