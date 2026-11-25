import type { ConversationScreenProps } from './ConversationScreenProps';
import type { ConversationSessions } from './conversationSessions';
import {
  captureReportBookmarkOwner,
  type ReportBookmarkVisibility,
} from './reportBookmarkOwnership';
import { visibleSavedHistoryDisplay } from './conversationSavedHistoryDisplay';
import {
  allowWarmConversationSender,
  isWarmConversationSender,
} from './warmConversationSender';

export interface BoundReportBookmark {
  readonly artifactId: string;
  readonly kind?: 'daily-report';
  readonly lease: Readonly<{ id: string; version: number }>;
  readonly current: () => boolean;
}

function latestReportArtifact(store: ConversationSessions, sessionId: number) {
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
  const last = session.messages.at(-1);
  const row = visibleSavedHistoryDisplay(session)?.at(-1)?.row;
  const candidate = last
    ? last.role === 'assistant' &&
      !last.streaming &&
      !last.incomplete && {
        id: last.retainedTurnId,
        healthSummary: last.healthSummary,
        dailyReport: last.dailyReport,
      }
    : row?.kind === 'answer' && !row.partial && row;
  if (!candidate || !candidate.id) return;
  if (candidate.dailyReport)
    return { artifactId: candidate.id, kind: 'daily-report' as const };
  const saved = candidate.healthSummary?.analysis.savedSummary;
  if (saved?.status === 'saved' && !saved.sourceChanged)
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
