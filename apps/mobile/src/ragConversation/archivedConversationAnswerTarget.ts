import { currentConversationMessages } from './currentConversationMessages';
import type { DisplayMessage } from './ConversationMessage';
import type { ConversationSession } from './conversationSessionTypes';
import {
  savedHistoryTranscript,
  visibleSavedHistoryDisplay,
} from './conversationSavedHistoryDisplay';

export type ArchivedConversationAnswerTarget = Readonly<{
  id: string;
  current: () => boolean;
  matches: (protectedAnswer: string) => boolean;
}>;

function ownsOrdinaryPreviousAnswer(
  tail: DisplayMessage | undefined,
  retainedId: string | undefined,
) {
  return (
    !!retainedId &&
    tail?.role === 'assistant' &&
    tail.retainedTurnId === retainedId &&
    !tail.incomplete &&
    !tail.streaming &&
    tail.completion !== 'partial' &&
    !tail.localClarification &&
    !tail.historyUnavailable &&
    !tail.dailyReport &&
    !tail.healthSummary &&
    !tail.visitQuestions &&
    !tail.visitQuestionsUnavailable &&
    !tail.submittedInput &&
    !tail.directPhotoReply &&
    !tail.savedPossibilityNarrative &&
    !tail.archivedVisitBookmark &&
    !tail.savedHistoryDisplayOnly &&
    !tail.interruptionReason
  );
}

/** Restore display rows are not send context. Capture only the latest exact
 * visible identity and a local comparison, never append their prose to history.
 * null blocks the action; undefined leaves an ordinary live target alone. */
export function archivedConversationAnswerTarget(input: {
  session: ConversationSession;
  find: () => ConversationSession | undefined;
  lease: () => { id: string; version: number } | null | undefined;
  current: () => boolean;
  currentUserId?: number;
  priorRetainedAnswerId?: string;
}): ArchivedConversationAnswerTarget | null | undefined {
  const { session } = input;
  const previous = currentConversationMessages(session).filter(
    message => message.id !== input.currentUserId,
  );
  // Do not let the retained-history collector skip over a newer visible row
  // and lend the older answer's valid storage identity to this user request.
  if (session.savedHistoryDisplay === undefined)
    return ownsOrdinaryPreviousAnswer(
      previous.at(-1),
      input.priorRetainedAnswerId,
    )
      ? undefined
      : null;
  const visible = visibleSavedHistoryDisplay(session);
  const lease = input.lease();
  if (!visible || !lease || !input.current()) return null;
  const tail = savedHistoryTranscript(visible, previous).at(-1);
  if (tail && !tail.savedHistoryDisplayOnly)
    return ownsOrdinaryPreviousAnswer(tail, input.priorRetainedAnswerId)
      ? undefined
      : null;
  const displayed = visible.find(item => item.answerId === tail?.id);
  if (!displayed) return null;
  const { row } = displayed;
  if (
    row.kind !== 'answer' ||
    !row.question ||
    !row.answer.trim() ||
    row.partial ||
    row.directPhoto ||
    row.savedPossibilityNarrative ||
    row.interruptionReason ||
    row.healthSummary ||
    row.dailyReport ||
    row.archivedVisitBookmark
  )
    return null;
  const { id, version } = lease;
  const answer = row.answer;
  return {
    id: row.id,
    matches: protectedAnswer => protectedAnswer === answer,
    current() {
      const active = input.lease();
      const latest = input.find();
      if (
        !input.current() ||
        !latest ||
        active?.id !== id ||
        active.version !== version
      )
        return false;
      const shown = visibleSavedHistoryDisplay(latest);
      if (!shown?.includes(displayed)) return false;
      const beforeRequest = currentConversationMessages(latest).filter(
        message => message.id !== input.currentUserId,
      );
      return (
        savedHistoryTranscript(shown, beforeRequest).at(-1)?.id ===
        displayed.answerId
      );
    },
  };
}
