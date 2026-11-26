import type { ConversationScreenProps } from './ConversationScreenProps';
import type { ConversationSessions } from './conversationSessions';
import {
  captureReportBookmarkOwner,
  type ReportBookmarkVisibility,
} from './reportBookmarkOwnership';
import {
  savedHistoryTranscript,
  visibleSavedHistoryDisplay,
} from './conversationSavedHistoryDisplay';
import {
  allowWarmConversationSender,
  isWarmConversationSender,
} from './warmConversationSender';

export interface BoundReportBookmark {
  readonly artifactId: string;
  readonly kind?: 'daily-report';
  readonly lease: Readonly<{ id: string; version: number }>;
  readonly current: () => boolean;
  readonly displayedReport?: import('../storage/dailyReportMemoryBookmark').DailyReportBookmarkTarget;
  readonly confirmProtection?: () => Promise<boolean>;
}

function latestReportCandidate(store: ConversationSessions, sessionId: number) {
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
  const last = savedHistoryTranscript(savedDisplay ?? [], session.messages).at(
    -1,
  );
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
    return { artifactId: candidate.id };
}

/** Bind a single already-displayed, completed artifact before ordinary dispatch.
 * A selected on-device tool decides whether to use it; no prompt parsing or extra call. */
export function semanticReportBookmarkSender(
  store: ConversationSessions,
  sessionId: number,
  current: ReportBookmarkVisibility | undefined,
  send: ConversationScreenProps['onSend'],
) {
  const report = latestReportArtifact(store, sessionId);
  const lease = report && store.savedReportLease(sessionId);
  if (!report || !lease) return { send, close: () => {} };
  const owner = captureReportBookmarkOwner({
    store,
    sessionId,
    current,
    allowOwnSend: true,
  });
  const target: BoundReportBookmark = {
    ...report,
    lease,
    current: owner.current,
  };
  const withTarget: ConversationScreenProps['onSend'] = (
    question,
    history,
    signal,
    observer,
    context,
  ) =>
    send(
      question,
      history,
      signal,
      observer?.inputOrigin === 'composer' &&
        !observer.photoInput &&
        !observer.selectedRecordingTranscript &&
        !signal?.aborted &&
        target.current()
        ? { ...observer, reportBookmark: target }
        : observer,
      context,
    );
  return {
    send: isWarmConversationSender(send)
      ? allowWarmConversationSender(withTarget)
      : withTarget,
    close: owner.close,
  };
}
