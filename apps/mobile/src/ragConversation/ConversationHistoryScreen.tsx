import { useEffect, useState, useSyncExternalStore } from 'react';
import { useConversationSessions } from './ConversationSessionsContext';
import { ConversationHistoryLayout } from './ConversationHistoryLayout';
import { AppButton as Button } from '../layout/AppButton';
import { AppText as Text } from '../layout/AppText';
import { t } from '../i18n';

export interface ConversationHistoryRow {
  readonly id: number;
  readonly title: string;
  readonly time: string;
  readonly section: string;
  readonly selected: boolean;
}

function dayLabel(value: string) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const key = (item: Date) => item.toLocaleDateString('ko-KR');
  return key(date) === key(today)
    ? t('ragConversation.history.today')
    : key(date) === key(yesterday)
      ? t('ragConversation.history.yesterday')
      : key(date);
}

/** Loads retained sessions locally; opening history never starts inference. */
export function ConversationHistoryScreen({
  onBack,
  onOpenSavedAnalysis,
  onOpenSavedVisitQuestions,
}: {
  readonly onBack: () => void;
  readonly onOpenSavedAnalysis?: () => void;
  readonly onOpenSavedVisitQuestions?: () => void;
}) {
  const store = useConversationSessions();
  const [attempt, setAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let current = true;
    setLoadFailed(false);
    store.loadHistory().catch(() => {
      if (current) setLoadFailed(true);
    });
    return () => {
      current = false;
    };
  }, [store, attempt]);
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  // Restored sessions can arrive newest first, so insertion order is not chronology.
  const rows = [...state.sessions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .map(session => ({
      id: session.id,
      title: session.title,
      selected: session.id === state.activeId,
      time: new Intl.DateTimeFormat('ko-KR', {
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(session.createdAt)),
      section: dayLabel(session.createdAt),
    }));
  const selectedSession = state.sessions.find(
    session => session.id === state.activeId,
  );
  const error = state.sessions.find(
    session => session.deletionError,
  )?.deletionError;

  return (
    <>
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {loadFailed ? (
        <>
          <Text accessibilityRole="alert">
            {t('ragConversation.history.restoreFailed')}
          </Text>
          <Button
            title={t('ragConversation.history.retryRestore')}
            onPress={() => setAttempt(value => value + 1)}
          />
        </>
      ) : null}
      <ConversationHistoryLayout
        deleted={state.deleted !== null}
        onBack={onBack}
        onCreateSession={store.create}
        onDeleteSession={store.remove}
        onOpenSavedAnalysis={onOpenSavedAnalysis}
        onOpenSavedVisitQuestions={onOpenSavedVisitQuestions}
        onSelectSession={store.select}
        onUndoRemove={store.undoRemove}
        rows={rows}
        selectedSession={selectedSession ?? null}
      />
    </>
  );
}
