import { openSavedGeneratedReportReferences } from '../memory/openSavedGeneratedReportReferences';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { useConversationSessions } from './ConversationSessionsContext';
import type { DisplayMessage } from './conversationDisplayMessage';

export const GeneratedReportBookmarkContext = createContext<{
  readonly sessionId: number;
  readonly isCurrent?: () => boolean;
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
  if (
    !owner ||
    message.role !== 'assistant' ||
    !message.dailyReport ||
    !artifactId ||
    message.streaming ||
    message.incomplete
  )
    return null;
  return (
    <BookmarkAction key={artifactId} artifactId={artifactId} owner={owner} />
  );
}

function BookmarkAction({
  artifactId,
  owner,
}: {
  artifactId: string;
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
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const save = async () => {
    if (pressing.current) return;
    const lease = store.savedReportLease(owner.sessionId);
    const current = () => {
      const active = store.getSnapshot();
      const session = active.sessions.find(item => item.id === active.activeId);
      const now = store.savedReportLease(owner.sessionId);
      return (
        mounted.current &&
        AppState.currentState === 'active' &&
        latest.current.sessionId === owner.sessionId &&
        (!latest.current.isCurrent || latest.current.isCurrent()) &&
        active.activeId === owner.sessionId &&
        Boolean(
          session &&
          !session.quarantined &&
          !session.restoring &&
          !session.modelSelectionPending &&
          !session.modelSelectionFailed &&
          !session.leaseRefreshRequired,
        ) &&
        now?.id === lease?.id &&
        now?.version === lease?.version
      );
    };
    if (!lease || !current()) return;
    pressing.current = true;
    setStatus('saving');
    try {
      const storage = await openSavedGeneratedReportReferences();
      const saved = await storage.bookmarkDailyReport({
        artifactId,
        lease,
        current,
      });
      if (mounted.current)
        setStatus(current() ? (saved ? 'saved' : 'failed') : 'idle');
    } catch {
      if (mounted.current) setStatus(current() ? 'failed' : 'idle');
    } finally {
      pressing.current = false;
    }
  };
  return (
    <>
      <AppButton
        title={t('savedMemory.bookmarkGeneratedReport')}
        variant="neutral"
        testID="conversation-bookmark-generated-report"
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
