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
  readonly lease: Readonly<{ id: string; version: number }>;
  readonly current: () => boolean;
}

function latestSummaryArtifact(store: ConversationSessions, sessionId: number) {
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
      !last.dailyReport &&
      !last.streaming &&
      !last.incomplete && {
        id: last.retainedTurnId,
        healthSummary: last.healthSummary,
      }
    : row?.kind === 'answer' && !row.dailyReport && !row.partial && row;
  if (!candidate || !candidate.id) return;
  const saved = candidate.healthSummary?.analysis.savedSummary;
  if (saved?.status === 'saved' && !saved.sourceChanged) return candidate.id;
}

/** Bind a single already-displayed, completed artifact before ordinary dispatch.
 * A selected on-device tool decides whether to use it; no prompt parsing or extra call. */
export function semanticReportBookmarkSender(
  store: ConversationSessions,
  sessionId: number,
  current: ReportBookmarkVisibility | undefined,
  send: ConversationScreenProps['onSend'],
) {
  const artifactId = latestSummaryArtifact(store, sessionId);
  const lease = artifactId && store.savedReportLease(sessionId);
  if (!artifactId || !lease) return { send, close: () => {} };
  const owner = captureReportBookmarkOwner({
    store,
    sessionId,
    current,
    allowOwnSend: true,
  });
  const target: BoundReportBookmark = {
    artifactId,
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
