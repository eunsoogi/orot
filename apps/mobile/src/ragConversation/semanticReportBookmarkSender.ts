import { currentConversationMessages } from './currentConversationMessages';
import { watchSavedReportNativeProtection } from '../generatedReports/savedReportNativeProtection';
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

export type BoundPossibilityBookmark = Readonly<{
  artifactId: string;
  createdAt: string;
  lease: BoundReportBookmark['lease'];
  current: () => boolean;
  confirmProtected: () => Promise<boolean>;
  requiresOriginalProof?: true;
}>;

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
  const live = !report ? latestReportCandidate(store, sessionId) : undefined;
  const possibility =
    live &&
    'committedPossibilityOriginal' in live &&
    live.committedPossibilityOriginal &&
    live.id &&
    live.committedPossibilityCreatedAt
      ? { artifactId: live.id, createdAt: live.committedPossibilityCreatedAt }
      : live &&
          'kind' in live &&
          live.kind === 'answer' &&
          live.savedPossibilityNarrative
        ? {
            artifactId: live.id,
            createdAt: live.createdAt,
            requiresOriginalProof: true as const,
          }
        : undefined;
  const lease = (report || possibility) && store.savedReportLease(sessionId);
  if (!lease) return { send, close: () => {} };
  const owner = captureReportBookmarkOwner({
    store,
    sessionId,
    current,
    allowOwnSend: true,
  });
  const target: BoundReportBookmark | undefined = report && {
    ...report,
    lease,
    current: owner.current,
  };
  let stopProtection: (() => void) | undefined;
  const bindPossibility = (signal: AbortSignal) => {
    if (!possibility) return;
    const stillVisible = () => {
      if (!owner.current()) return false;
      const session = store
        .getSnapshot()
        .sessions.find(row => row.id === sessionId);
      if (!session) return false;
      // Archive metadata is a locator only, not proof that the original is
      // typed, current, or even openable. The service re-proves it before use.
      if ('requiresOriginalProof' in possibility)
        return (
          visibleSavedHistoryDisplay(session)?.some(
            ({ row }) =>
              row.kind === 'answer' &&
              row.savedPossibilityNarrative &&
              row.id === possibility.artifactId &&
              row.createdAt === possibility.createdAt,
          ) === true
        );
      return session.messages.some(
        message =>
          message.retainedTurnId === possibility.artifactId &&
          message.committedPossibilityOriginal &&
          message.committedPossibilityCreatedAt === possibility.createdAt,
      );
    };
    if (!stillVisible()) return;
    const native = watchSavedReportNativeProtection(signal, owner.close);
    if (!native) return;
    stopProtection = native.dispose;
    return {
      ...possibility,
      lease,
      current: () => stillVisible() && native.current(),
      confirmProtected: native.confirm,
    } satisfies BoundPossibilityBookmark;
  };
  const withTarget: ConversationScreenProps['onSend'] = (
    question,
    history,
    signal,
    observer,
    context,
  ) => {
    if (
      observer?.inputOrigin !== 'composer' ||
      observer.photoInput ||
      observer.selectedRecordingTranscript ||
      signal?.aborted ||
      !owner.current()
    )
      return send(question, history, signal, observer, context);
    const possibilityBookmark = signal && bindPossibility(signal);
    return send(
      question,
      history,
      signal,
      target
        ? { ...observer, reportBookmark: target }
        : possibilityBookmark
          ? { ...observer, possibilityBookmark }
          : observer,
      context,
    );
  };
  return {
    send: isWarmConversationSender(send)
      ? allowWarmConversationSender(withTarget)
      : withTarget,
    close() {
      stopProtection?.();
      owner.close();
    },
  };
}
