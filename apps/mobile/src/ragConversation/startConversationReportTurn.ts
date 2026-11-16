import type { ConversationSessions } from './conversationSessions';
import type { ConversationScreenProps } from './ConversationScreenProps';
import { canSelectConversationChoice } from './selectConversationChoice';
import { setConversationEntryForSession } from './useConversationEntryIntent';
import { entryIntentSender } from './entryIntentSender';
import { todayIdentity } from '../aiFeatures/integration/dailyReportTodayIdentity';
import { t } from '../i18n';

/** A live report choice submits one owned turn, using the same transcript, consent and cancellation. */
export function startConversationReportTurn(
  store: ConversationSessions,
  isCurrent: () => boolean,
  sender: ConversationScreenProps['onSend'],
) {
  if (!isCurrent()) return;
  const snapshot = store.getSnapshot();
  const session = snapshot.sessions.find(item => item.id === snapshot.activeId);
  if (!session || !canSelectConversationChoice(store, session)) return;
  const reportRequest = todayIdentity();
  if (!reportRequest) {
    store.setError(session.id, t('dailyReport.entryError'));
    return;
  }
  setConversationEntryForSession(store, session.id, {
    intent: 'daily-report',
    entryKey: `conversation-report:${session.id}`,
    reportRequest,
  });
  return store.sendPrompt(
    session.id,
    t('dailyReport.title'),
    entryIntentSender(store, session.id, sender),
  );
}
