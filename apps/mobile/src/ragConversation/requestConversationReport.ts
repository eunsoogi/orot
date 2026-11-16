import { requestReportStart } from './conversationReportStart';
import type { ConversationSessions } from './conversationSessions';
import { todayIdentity } from '../aiFeatures/integration/dailyReportTodayIdentity';
import { t } from '../i18n';

const pending = new WeakSet<ConversationSessions>();

/** Retain a date-bound task in the selected session; only explicit taps may request a live start. */
export async function requestConversationReport(
  store: ConversationSessions,
  isCurrent: () => boolean,
  onReady?: () => void,
  startFromTap = false,
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
    // and serializes duplicates. Only a live explicit quick-choice may request a one-shot start; restored cards never do.
    await store.saveTaskCard(activeId, `daily-report:${identity.key}`, {
      kind: 'daily_report',
      identity,
    });
    // Saving can outlive navigation or a session change. Keep the saved task but
    // never pull the user away from their newer destination.
    if (isCurrent() && store.getSnapshot().activeId === activeId) {
      if (startFromTap)
        requestReportStart(
          store,
          activeId,
          `daily-report:${identity.key}`,
          isCurrent,
        );
      onReady?.();
    }
    return 'saved' as const;
  } catch {
    store.setError(activeId, t('ragConversation.conversation.restoreFailed'));
    return 'failed' as const;
  } finally {
    pending.delete(store);
  }
}
