import {
  bindArchivedHealthSummarySection,
  type ArchivedHealthSummarySection,
} from './archivedHealthSummarySectionOwner';
import {
  latestReportArtifact,
  latestReportCandidate,
} from './latestConversationBookmarkTarget';
export {
  latestConversationPossibilityArtifact,
  latestReportArtifact,
} from './latestConversationBookmarkTarget';
import { watchSavedReportNativeProtection } from '../generatedReports/savedReportNativeProtection';
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
  readonly displayedReport?: import('../storage/dailyReportMemoryBookmark').DailyReportBookmarkTarget;
  readonly section?: ArchivedHealthSummarySection;
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
/** Bind a single already-displayed, completed artifact before ordinary dispatch.
 * Protected summary sections receive a separate lease; the on-device model
 * must resolve the current request before accessing that leased summary. */
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
  let stopProtection: (() => void) | undefined;
  const owner = captureReportBookmarkOwner({
    store,
    sessionId,
    current,
    allowOwnSend: true,
    onLost: () => stopProtection?.(),
  });
  const target: BoundReportBookmark | undefined = report && {
    ...report,
    lease,
    current: owner.current,
  };
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
    const section =
      signal && report?.summaryRevision
        ? bindArchivedHealthSummarySection(
            store,
            sessionId,
            { ...report, summaryRevision: report.summaryRevision },
            owner.current,
            signal,
          )
        : undefined;
    stopProtection = section?.dispose;
    const possibilityBookmark = signal && bindPossibility(signal);
    return send(
      question,
      history,
      signal,
      target
        ? {
            ...observer,
            reportBookmark: section
              ? { ...target, section: section.section }
              : target,
          }
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
