import { AppState } from 'react-native';
import { captureDailyReportMemoryTap } from '../storage/dailyReportMemoryTap';
import type { ConversationSessions } from './conversationSessions';
import type { ConversationScreenProps } from './ConversationScreenProps';
import { canSelectConversationChoice } from './selectConversationChoice';
import { setConversationEntryForSession } from './useConversationEntryIntent';
import { entryIntentSender } from './entryIntentSender';
import { todayIdentity } from '../aiFeatures/integration/dailyReportTodayIdentity';
import { t } from '../i18n';
import type { DailyReportIdentity } from '@orot/domain';

/** A live report choice submits one owned turn, using the same transcript, consent and cancellation. */
export function startConversationReportTurn(
  store: ConversationSessions,
  isCurrent: () => boolean,
  sender: ConversationScreenProps['onSend'],
  notificationIdentity?: DailyReportIdentity,
  origin?: 'direct-user-tap',
) {
  if (!isCurrent()) return;
  const snapshot = store.getSnapshot();
  const session = snapshot.sessions.find(item => item.id === snapshot.activeId);
  if (!session || !canSelectConversationChoice(store, session)) return;
  const today = todayIdentity();
  if (notificationIdentity && notificationIdentity.key !== today?.key) return;
  const reportRequest = notificationIdentity ?? today;
  if (!reportRequest) {
    store.setError(session.id, t('dailyReport.entryError'));
    return;
  }
  setConversationEntryForSession(store, session.id, {
    intent: 'daily-report',
    entryKey: `conversation-report:${session.id}`,
    reportRequest,
  });
  const tap =
    notificationIdentity || !origin || AppState.currentState !== 'active'
      ? undefined
      : captureDailyReportMemoryTap();
  return store.sendPrompt(
    session.id,
    t('dailyReport.title'),
    entryIntentSender(
      store,
      session.id,
      sender,
      'shortcut',
      notificationIdentity ? undefined : origin,
      tap,
    ),
  );
}
