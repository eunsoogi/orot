import { useSyncExternalStore } from 'react';
import { useConversationSessions } from './ConversationSessionsContext';
import { ConversationHistoryLayout } from './ConversationHistoryLayout';

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
    ? '오늘'
    : key(date) === key(yesterday)
      ? '어제'
      : key(date);
}

/** Shows only app-owned conversation state; the preview never resolves evidence or starts inference. */
export function ConversationHistoryScreen({
  onBack,
}: {
  readonly onBack: () => void;
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

  return (
    <ConversationHistoryLayout
      deleted={state.deleted !== null}
      onBack={onBack}
      onCreateSession={store.create}
      onDeleteSession={store.remove}
      onSelectSession={store.select}
      onUndoRemove={store.undoRemove}
      rows={rows}
      selectedSession={selectedSession ?? null}
    />
  );
}
