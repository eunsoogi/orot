import { createDailyReminderConversationOwner } from './dailyReminderConversationOwner';
import { createDailyReportIdentity } from '@orot/domain';
import type { ConversationSessions } from '../ragConversation/conversationSessions';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { ConversationSessionOptions } from '../ragConversation/conversationSessionTypes';
import type { DailyReminderEntry } from './dailyReminderDelivery';

/** Retain the delivered local-day context before consuming the inbox; never generate from a tap. */
export function createDailyReminderConversation(input: {
  controller: NavigationController<AppNavigationRoute>;
  sessions: ConversationSessions;
  confirm: (
    key: string,
  ) => Promise<'approved' | 'declined' | 'unavailable' | 'busy'>;
  openRoot?: (key: string) => boolean;
  canEnter?: () => boolean;
  isCurrent?: () => boolean;
  retention?: ConversationSessionOptions['retention'];
  signal?: AbortSignal;
}) {
  let currentEntry = () => false;
  const resolveOwner = createDailyReminderConversationOwner({
    sessions: input.sessions,
    retention: input.retention,
    isCurrent: () => currentEntry(),
    signal: input.signal ?? new AbortController().signal,
  });
  return async (entry: DailyReminderEntry) => {
    if (
      !input.openRoot ||
      input.canEnter?.() === false ||
      input.isCurrent?.() === false
    )
      return 'busy' as const;
    const before = input.controller.getSnapshot();
    const startingActive = input.sessions.getSnapshot().activeId;
    const current = () => {
      const snapshot = input.controller.getSnapshot();
      return (
        input.canEnter?.() !== false &&
        input.isCurrent?.() !== false &&
        !snapshot.isTransitioning &&
        snapshot.currentRoute.key === before.currentRoute.key &&
        input.sessions.getSnapshot().activeId === startingActive
      );
    };
    currentEntry = current;
    const decision = await input.confirm(before.currentRoute.key);
    if (decision !== 'approved') return decision;
    if (!current()) return 'busy' as const;
    const owner = await resolveOwner(entry);
    if (!current()) return 'busy' as const;
    // The delivery zone is unknown; preserve the existing observed-zone basis and warning.
    const identity = createDailyReportIdentity(
      entry.selectedRequest?.localDate ?? entry.dateInObservedTimeZone,
      entry.selectedRequest?.timeZone ?? entry.observedTimeZone,
    );
    const retained = input.sessions
      .getSnapshot()
      .sessions.find(session => session.id === owner)
      ?.taskCards?.find(card => card.id === entry.entryKey);
    if (retained && retained.task.kind !== 'daily_report')
      return 'unavailable' as const;
    // A user may have explicitly selected another day after a failed inbox acknowledgement.
    // Reopening that same retained card must never overwrite its choice or committed result.
    if (!retained)
      await input.sessions.saveTaskCard(owner, entry.entryKey, {
        kind: 'daily_report',
        identity,
        reminder: true,
      });
    if (!current() || !input.openRoot(before.currentRoute.key))
      return 'busy' as const;
    if (input.canEnter?.() === false || input.isCurrent?.() === false)
      return 'busy' as const;
    input.sessions.select(owner);
    if (input.canEnter?.() === false || input.isCurrent?.() === false)
      return 'busy' as const;
    return 'opened' as const;
  };
}
