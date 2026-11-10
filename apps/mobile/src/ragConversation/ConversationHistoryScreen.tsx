import { useSyncExternalStore } from 'react';
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

/** Shows only app-owned conversation state; the preview never resolves evidence or starts inference. */
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
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const rows = [...state.sessions].reverse().map(session => ({
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
      <ConversationHistoryLayout
        header={
          <>
            {/* Saved outputs remain reachable without restoring a feature-selection dashboard. */}
            {onOpenSavedAnalysis ? (
              <Button
                title={t('ragConversation.history.savedAnalysis')}
                onPress={onOpenSavedAnalysis}
                testID="conversation-saved-analysis"
              />
            ) : null}
            {onOpenSavedVisitQuestions ? (
              <Button
                title={t('ragConversation.history.savedVisitQuestions')}
                onPress={onOpenSavedVisitQuestions}
                testID="conversation-saved-visit-questions"
              />
            ) : null}
          </>
        }
        deleted={state.deleted !== null}
        onBack={onBack}
        onCreateSession={store.create}
        onDeleteSession={store.remove}
        onSelectSession={store.select}
        onUndoRemove={store.undoRemove}
        rows={rows}
        selectedSession={selectedSession ?? null}
      />
    </>
  );
}
