import { captureArchivedSummaryBookmarkProtection } from './archivedSummaryBookmarkProtection';
import { ArchivedVisitQuestionBookmark } from './ArchivedVisitQuestionBookmark';
import { openSavedGeneratedReportReferences } from '../memory/openSavedGeneratedReportReferences';
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  captureReportBookmarkOwner,
  type ReportBookmarkVisibility,
} from './reportBookmarkOwnership';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { useConversationSessions } from './ConversationSessionsContext';
import type { DisplayMessage } from './conversationDisplayMessage';
import { visitQuestionsBookmarkTarget } from './visitQuestionsBookmarkTarget';
import type { DailyReportBookmarkTarget } from '../storage/dailyReportMemoryBookmark';
export const GeneratedReportBookmarkContext = createContext<{
  readonly sessionId: number;
  readonly isCurrent?: ReportBookmarkVisibility;
} | null>(null);

/** The button uses the visible report's own identity; no prompt or model can supply an ID. */
export function GeneratedReportBookmark({
  message,
}: {
  message: DisplayMessage;
}) {
  const owner = useContext(GeneratedReportBookmarkContext);
  const artifactId =
    message.retainedTurnId ??
    (message.savedHistoryDisplayOnly
      ? message.voiceTimelineOrder?.id
      : undefined);
  const summary = message.healthSummary?.analysis.savedSummary;
  const daily = message.dailyReport;
  const visit = message.visitQuestions;
  const marker = message.archivedVisitBookmark;
  if (
    owner &&
    marker &&
    message.savedHistoryDisplayOnly &&
    message.voiceTimelineOrder &&
    message.role === 'assistant' &&
    !message.incomplete &&
    !message.streaming &&
    !daily &&
    !message.healthSummary &&
    !visit
  )
    return (
      <ArchivedVisitQuestionBookmark
        key={`${owner.sessionId}:${marker.key}`}
        marker={marker}
        turn={message.voiceTimelineOrder}
        localId={owner.sessionId}
        visible={owner.isCurrent}
      />
    );
  // The saved/reviewed rows can change. Only the original visible generated subset is targetable.
  const visitTarget =
    !daily &&
    !message.healthSummary &&
    visit &&
    !message.visitQuestionsUnavailable
      ? visitQuestionsBookmarkTarget(
          visit.appointment.id,
          visit.review.items
            .filter(item => item.origin === 'candidate')
            .map(item => item.question),
        )
      : undefined;
  const archivedSummaryRevision = message.savedHistoryDisplayOnly
    ? message.healthSummary?.archivedSummaryRevision
    : undefined;
  const bookmarkableSummary =
    !daily &&
    summary?.status === 'saved' &&
    !summary.sourceChanged &&
    (!message.savedHistoryDisplayOnly || Boolean(archivedSummaryRevision));
  if (
    !owner ||
    message.role !== 'assistant' ||
    (!daily && !bookmarkableSummary && !visitTarget) ||
    (daily && (message.healthSummary || message.visitQuestions)) ||
    !artifactId ||
    message.streaming ||
    message.incomplete
  )
    return null;
  // A tap uses the same report revision the user sees; a newly replaced
  // revision cannot inherit a pending click on the original.
  const target = daily && {
    runId: daily.runId,
    revision: daily.revision,
    identityKey: daily.identity.key,
  };
  return (
    <BookmarkAction
      key={JSON.stringify([
        artifactId,
        target,
        visitTarget,
        archivedSummaryRevision,
      ])}
      artifactId={artifactId}
      owner={owner}
      daily={target}
      visit={visitTarget}
      archivedSummaryRevision={archivedSummaryRevision}
    />
  );
}

function BookmarkAction({
  artifactId,
  owner,
  daily,
  visit,
  archivedSummaryRevision,
}: {
  artifactId: string;
  daily?: DailyReportBookmarkTarget;
  visit?: string;
  archivedSummaryRevision?: string;
  owner: NonNullable<React.ContextType<typeof GeneratedReportBookmarkContext>>;
}) {
  const store = useConversationSessions();
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>(
    'idle',
  );
  const mounted = useRef(false);
  const pressing = useRef(false);
  const latest = useRef(owner);
  latest.current = owner;
  const protectedTap = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      protectedTap.current?.();
    };
  }, []);
  const save = async () => {
    if (pressing.current) return;
    const lease = store.savedReportLease(owner.sessionId);
    const lifetime = captureReportBookmarkOwner({
      store,
      sessionId: owner.sessionId,
      current: owner.isCurrent,
      mounted: () =>
        mounted.current && latest.current.sessionId === owner.sessionId,
      allowDraftChanges: true,
    });
    let scope:
      ReturnType<typeof captureArchivedSummaryBookmarkProtection> | undefined;
    const current = () => (scope?.current() ?? true) && lifetime.current();
    if (!lease || !current()) {
      lifetime.close();
      return;
    }
    pressing.current = true;
    setStatus('saving');
    try {
      scope = archivedSummaryRevision
        ? captureArchivedSummaryBookmarkProtection()
        : undefined;
      protectedTap.current = scope?.close ?? null;
      if (scope && (!(await scope.confirmProtected()) || !current()))
        throw new Error('Archived summary owner moved.');
      const storage = await openSavedGeneratedReportReferences();
      if (scope && !current()) throw new Error('Archived summary owner moved.');
      const saved = daily
        ? await storage.bookmarkDailyReport({
            artifactId,
            lease,
            current,
            displayedReport: daily,
          })
        : visit
          ? await storage.bookmarkVisitQuestions({
              artifactId,
              displayed: visit,
              lease,
              current,
            })
          : await storage.bookmarkHealthSummary({
              artifactId,
              lease,
              current,
              ...(archivedSummaryRevision && scope
                ? {
                    archive: {
                      revision: archivedSummaryRevision,
                      confirmProtected: scope.confirmProtected,
                    },
                  }
                : {}),
            });
      if (mounted.current)
        setStatus(current() ? (saved ? 'saved' : 'failed') : 'idle');
    } catch {
      if (mounted.current) setStatus(current() ? 'failed' : 'idle');
    } finally {
      scope?.close();
      protectedTap.current = null;
      lifetime.close();
      pressing.current = false;
    }
  };
  return (
    <>
      <AppButton
        title={t(
          daily
            ? 'savedMemory.bookmarkDailyReport'
            : visit
              ? 'savedMemory.bookmarkVisitQuestions'
              : 'savedMemory.bookmarkHealthSummary',
        )}
        variant="neutral"
        testID={
          daily
            ? 'conversation-bookmark-daily-report'
            : visit
              ? 'conversation-bookmark-visit-questions'
              : 'conversation-bookmark-generated-report'
        }
        disabled={status === 'saving'}
        onPress={() => {
          save();
        }}
      />
      {status === 'saved' || status === 'failed' ? (
        <AppText accessibilityLiveRegion="polite">
          {t(
            status === 'saved'
              ? 'savedMemory.generatedReportSaved'
              : 'savedMemory.generatedReportUnavailable',
          )}
        </AppText>
      ) : null}
    </>
  );
}
