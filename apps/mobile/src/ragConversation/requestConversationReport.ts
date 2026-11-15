import type { ConversationSessions } from './conversationSessions';
import { todayIdentity } from '../aiFeatures/integration/dailyReportTodayIdentity';
import { t } from '../i18n';

const pending = new WeakSet<ConversationSessions>();

/** Retain a date-bound task in the selected session, never a new route or inference run. */
export async function requestConversationReport(
  store: ConversationSessions,
  isCurrent: () => boolean,
  onReady?: () => void,
) {
  if (!isCurrent() || pending.has(store)) return 'ignored' as const;
  const { activeId } = store.getSnapshot();
  const identity = todayIdentity();
  if (!identity) {
    store.setError(activeId, t('dailyReport.entryError'));
    return 'failed' as const;
  }
  pending.add(store);
  try {
    // Per-date identity preserves earlier cards; saveTaskCard keeps an existing result
    // and serializes duplicates. The normal report card still requires confirmation.
    await store.saveTaskCard(activeId, `daily-report:${identity.key}`, {
      kind: 'daily_report',
      identity,
    });
    // Saving can outlive navigation or a session change. Keep the saved task but
    // never pull the user away from their newer destination.
    if (isCurrent() && store.getSnapshot().activeId === activeId) onReady?.();
    return 'saved' as const;
  } catch {
    store.setError(activeId, t('ragConversation.conversation.restoreFailed'));
    return 'failed' as const;
  } finally {
    pending.delete(store);
  }
}
