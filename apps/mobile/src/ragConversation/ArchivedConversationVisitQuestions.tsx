import { useLayoutEffect, useState } from 'react';
import { AppState } from 'react-native';
import { t } from '../i18n';
import { AppText } from '../layout/AppText';
import { QuestionCard } from '../nextVisitQuestions/QuestionCard';
import { VisitQuestionTemplate } from '../nextVisitQuestions/VisitQuestionTemplate';
import type { NextVisitQuestionsTheme } from '../nextVisitQuestions/types';
import { watchSavedReportNativeProtection } from '../generatedReports/savedReportNativeProtection';
import { openSavedGeneratedReportReferences } from '../memory/openSavedGeneratedReportReferences';
import type { ArchivedVisitInlineQuestion } from '../storage/archivedVisitBookmarkAccess';
import { archivedVisitBookmarkOriginal } from '../storage/archivedVisitBookmarkIdentity';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import type { DisplayMessage } from './conversationDisplayMessage';
import type { ConversationSessions } from './conversationSessions';
import {
  captureReportBookmarkOwner,
  type ReportBookmarkVisibility,
} from './reportBookmarkOwnership';

/** Cold display uses an exact protected original, never an editor/save or model path. */
export function ArchivedConversationVisitQuestions({
  message,
  sessionId,
  store,
  visible,
  theme,
}: {
  readonly message: DisplayMessage;
  readonly sessionId: number;
  readonly store: ConversationSessions;
  readonly visible?: ReportBookmarkVisibility;
  readonly theme: NextVisitQuestionsTheme;
}) {
  const marker = message.archivedVisitBookmark;
  const turnId = message.voiceTimelineOrder?.id;
  const createdAt = message.voiceTimelineOrder?.createdAt;
  const [generation, setGeneration] = useState(0);
  const [questions, setQuestions] = useState<
    readonly ArchivedVisitInlineQuestion[] | null
  >();
  const routeVisible = visible?.() ?? true;
  useLayoutEffect(() => {
    const app = AppState.addEventListener('change', phase => {
      if (phase === 'active') setGeneration(previous => previous + 1);
    });
    const root = visible?.subscribeRoot?.(shown => {
      if (shown) setGeneration(previous => previous + 1);
    });
    return () => {
      app.remove();
      root?.();
    };
  }, [visible]);
  useLayoutEffect(() => {
    setQuestions(undefined);
    const lease = store.savedReportLease(sessionId);
    const original =
      marker && lease && archivedVisitBookmarkOriginal(marker, lease);
    if (
      !routeVisible ||
      !lease ||
      !marker ||
      !original ||
      original.id !== turnId ||
      original.createdAt !== createdAt
    )
      return;
    const controller = new AbortController();
    const lost = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      setQuestions(undefined);
    };
    const owner = captureReportBookmarkOwner({
      store,
      sessionId,
      current: visible,
      allowDraftChanges: true,
      onLost: lost,
    });
    const retireClear = subscribeLocalDataClear(lost);
    const retireSource = subscribeLocalSourceDeletion(lost);
    const current = () => !controller.signal.aborted && owner.current();
    if (current()) {
      const native = watchSavedReportNativeProtection(controller.signal, lost);
      const read = async () => {
        if (!native || !(await native.confirm()) || !current()) return;
        const storage = await openSavedGeneratedReportReferences();
        if (!(await native.confirm()) || !current()) return;
        // The final asynchronous read is the source/row proof. Native loss
        // during that read still retires this operation through the watcher.
        const currentRead = () => native.current() && current();
        const preview = await storage.readArchivedVisitBookmarkPreview({
          marker,
          lease,
          current: currentRead,
        });
        // Only the projected rows survive; this display never holds write authority.
        if (preview) storage.abandonArchivedVisitBookmarkPreview(preview);
        if (currentRead()) setQuestions(preview?.questions ?? null);
      };
      read().catch(() => {
        if (current()) setQuestions(null);
      });
    }
    return () => {
      controller.abort();
      owner.close();
      retireClear();
      retireSource();
    };
  }, [
    createdAt,
    generation,
    marker,
    routeVisible,
    sessionId,
    store,
    turnId,
    visible,
  ]);
  if (!routeVisible || questions === undefined) return null;
  if (!questions)
    return (
      <AppText accessibilityRole="alert">
        {t('ragConversation.conversation.savedVisitQuestionsUnavailable')}
      </AppText>
    );
  return (
    <VisitQuestionTemplate theme={theme}>
      {questions.map(({ id, questionText, rationale, priority }, index) => (
        <QuestionCard
          key={id}
          compact
          readOnlyArchive
          index={index}
          count={questions.length}
          question={{ questionText, rationale, priority, citations: [] }}
          editable={false}
          disabled
          theme={theme}
          onUpdate={() => {}}
          onMove={() => {}}
          onRemove={() => {}}
          onOpenSource={() => {}}
        />
      ))}
    </VisitQuestionTemplate>
  );
}
