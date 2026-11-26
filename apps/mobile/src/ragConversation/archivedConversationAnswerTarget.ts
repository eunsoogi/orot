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

/** Restore display rows are not send context. Capture only the latest exact
 * visible identity and a local comparison, never append their prose to history.
 * null blocks the action; undefined leaves an ordinary live target alone. */
export function archivedConversationAnswerTarget(input: {
  session: ConversationSession;
  find: () => ConversationSession | undefined;
  lease: () => { id: string; version: number } | null | undefined;
  current: () => boolean;
  currentUserId?: number;
}): ArchivedConversationAnswerTarget | null | undefined {
  const { session } = input;
  if (session.savedHistoryDisplay === undefined) return;
  const visible = visibleSavedHistoryDisplay(session);
  const lease = input.lease();
  if (!visible || !lease || !input.current()) return null;
  const tail = savedHistoryTranscript(visible, session.messages).at(-1);
  if (tail && !tail.savedHistoryDisplayOnly) {
    // A newer locally published turn supersedes any archive target; never
    // skip a newer ineligible message to save a much older archived answer.
    return tail.role === 'assistant' &&
      !tail.incomplete &&
      !tail.localClarification &&
      !tail.historyUnavailable &&
      !tail.dailyReport &&
      !tail.healthSummary &&
      !tail.visitQuestions &&
      !tail.submittedInput &&
      Boolean(tail.retainedTurnId)
      ? undefined
      : null;
  }
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
      const beforeRequest = latest.messages.filter(
        message => message.id !== input.currentUserId,
      );
      return (
        savedHistoryTranscript(shown, beforeRequest).at(-1)?.id ===
        displayed.answerId
      );
    },
  };
}
