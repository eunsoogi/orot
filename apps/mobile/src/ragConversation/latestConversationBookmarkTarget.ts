import { currentConversationMessages } from './currentConversationMessages';
import {
  savedHistoryTranscript,
  visibleSavedHistoryDisplay,
} from './conversationSavedHistoryDisplay';
import type { ConversationSessions } from './conversationSessions';

export function latestReportCandidate(
  store: ConversationSessions,
  sessionId: number,
) {
  const session = store
    .getSnapshot()
    .sessions.find(row => row.id === sessionId);
  if (
    !session ||
    session.busy ||
    session.preparingSend ||
    store.photoDrafts.get(sessionId).status !== 'empty'
  )
    return;
  const savedDisplay = visibleSavedHistoryDisplay(session);
  if (session.savedHistoryDisplay && !savedDisplay) return;
  // Use the same order as the displayed transcript: a newly saved local
  // photo can follow a live report even though it resides in the archive list.
  const last = savedHistoryTranscript(
    savedDisplay ?? [],
    currentConversationMessages(session),
  ).at(-1);
  if (
    !last ||
    last.role !== 'assistant' ||
    last.streaming ||
    last.incomplete ||
    last.completion === 'partial' ||
    last.localClarification ||
    last.historyUnavailable ||
    last.interruptionReason ||
    last.directPhotoReply
  )
    return;
  const saved = last.savedHistoryDisplayOnly
    ? savedDisplay?.find(item => item.answerId === last.id)?.row
    : undefined;
  const candidate = last.savedHistoryDisplayOnly
    ? saved?.kind === 'answer' && !saved.partial && !saved.directPhoto && saved
    : {
        id: last.retainedTurnId,
        healthSummary: last.healthSummary,
        dailyReport: last.dailyReport,
        committedPossibilityOriginal: last.committedPossibilityOriginal,
        committedPossibilityCreatedAt: last.committedPossibilityCreatedAt,
      };
  return candidate || undefined;
}

/** The live completion receipt elects only the exact adjacent original. */
export function latestConversationPossibilityArtifact(
  store: ConversationSessions,
  sessionId: number,
) {
  const candidate = latestReportCandidate(store, sessionId);
  return candidate &&
    'committedPossibilityOriginal' in candidate &&
    candidate.committedPossibilityOriginal
    ? candidate.id
    : undefined;
}
export function latestReportArtifact(
  store: ConversationSessions,
  sessionId: number,
) {
  const candidate = latestReportCandidate(store, sessionId);
  if (!candidate?.id) return;
  if (candidate.dailyReport) {
    const { identity, runId, revision } = candidate.dailyReport;
    return {
      artifactId: candidate.id,
      kind: 'daily-report' as const,
      displayedReport: { identityKey: identity.key, runId, revision },
    };
  }
  const summary = candidate.healthSummary?.analysis.savedSummary;
  if (summary?.status === 'saved' && !summary.sourceChanged)
    return {
      artifactId: candidate.id,
      summaryRevision: candidate.healthSummary?.archivedSummaryRevision,
    };
}
