import { watchSavedReportNativeProtection } from '../generatedReports/savedReportNativeProtection';
import { subscribeConversationVisibility } from '../storage/conversationVisibilityEvents';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { visibleSavedHistoryDisplay } from './conversationSavedHistoryDisplay';
import type { ConversationSessions } from './conversationSessions';

export type ArchivedHealthSummarySection = {
  readonly revision: string;
  readonly signal: AbortSignal;
  readonly current: () => boolean;
  readonly confirmProtected: () => Promise<boolean>;
};

export function bindArchivedHealthSummarySection(
  store: ConversationSessions,
  sessionId: number,
  report: { artifactId: string; summaryRevision: string },
  currentOwner: () => boolean,
  signal: AbortSignal,
) {
  const current = () => {
    const session = store
      .getSnapshot()
      .sessions.find(row => row.id === sessionId);
    return (
      currentOwner() &&
      !!session &&
      !!visibleSavedHistoryDisplay(session)?.some(({ row }) => {
        if (row.kind !== 'answer' || row.id !== report.artifactId) return false;
        const saved = row.healthSummary?.analysis.savedSummary;
        return (
          row.healthSummary?.archivedSummaryRevision ===
            report.summaryRevision &&
          saved?.status === 'saved' &&
          !saved.sourceChanged
        );
      })
    );
  };
  if (!current() || signal.aborted) return;
  const scope = new AbortController();
  const cleanups: Array<() => void> = [];
  const dispose = () => {
    scope.abort();
    signal.removeEventListener('abort', dispose);
    for (const close of cleanups.splice(0)) close();
  };
  const invalidated = dispose;
  signal.addEventListener('abort', dispose, { once: true });
  const native = watchSavedReportNativeProtection(scope.signal, invalidated);
  if (!native) {
    dispose();
    return;
  }
  cleanups.push(
    native.dispose,
    subscribeConversationVisibility(invalidated),
    subscribeLocalDataClear(invalidated),
    subscribeLocalSourceDeletion(invalidated),
  );
  return {
    dispose,
    section: {
      revision: report.summaryRevision,
      signal: scope.signal,
      current: () => current() && native.current(),
      async confirmProtected() {
        return current() && (await native.confirm()) && current();
      },
    } satisfies ArchivedHealthSummarySection,
  };
}
