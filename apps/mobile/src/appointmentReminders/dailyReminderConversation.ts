import { todayIdentity } from '../aiFeatures/integration/dailyReportTodayIdentity';
import { dailyReminderPromptRendezvous } from './dailyReminderPromptRendezvous';
import { createDailyReminderConversationOwner } from './dailyReminderConversationOwner';
import { createDailyReportIdentity } from '@orot/domain';
import type { ConversationSessions } from '../ragConversation/conversationSessions';
import type { NavigationController } from '../navigation/navigationController';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import type { ConversationSessionOptions } from '../ragConversation/conversationSessionTypes';
import type { DailyReminderEntry } from './dailyReminderDelivery';

/** Reuse the canonical root; only new current-day entries can offer the normal report action. */
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
  claimPrompt?: (deliveredAt: string) => Promise<boolean>;
  promptAllowed?: () => boolean;
  capturePromptRoot?: () => () => boolean;
}) {
  let currentEntry = () => false;
  const resolveOwner = createDailyReminderConversationOwner({
    sessions: input.sessions,
    retention: input.retention,
    isCurrent: () => currentEntry(),
    signal: input.signal ?? new AbortController().signal,
  });
  return async (
    entry: DailyReminderEntry,
    prepareFresh?: (offer: () => void) => void,
  ) => {
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
    let fresh = false;
    if (
      prepareFresh &&
      input.capturePromptRoot &&
      input.promptAllowed?.() &&
      !entry.selectedRequest &&
      identity.key === todayIdentity()?.key
    ) {
      try {
        fresh = (await input.claimPrompt?.(entry.deliveredAt)) === true;
      } catch {
        // A missing protected receipt denies automation, not the existing manual report route.
      }
    }
    if (!current()) return 'busy' as const;
    const retained = input.sessions
      .getSnapshot()
      .sessions.find(session => session.id === owner)
      ?.taskCards?.find(card => card.id === entry.entryKey);
    if (retained && retained.task.kind !== 'daily_report')
      return 'unavailable' as const;
    // A user may have explicitly selected another day after a failed inbox acknowledgement.
    // Reopening that same retained card must never overwrite its choice or committed result.
    if (!retained && !fresh)
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
    if (fresh && !retained && prepareFresh) {
      const root = input.controller.getSnapshot();
      const rootCurrent = input.capturePromptRoot?.();
      const stillOwned = () =>
        !input.signal?.aborted &&
        input.isCurrent?.() !== false &&
        rootCurrent?.() === true &&
        input.controller.getSnapshot() === root &&
        input.sessions.getSnapshot().activeId === owner &&
        identity.key === todayIdentity()?.key;
      prepareFresh(() => {
        if (input.canEnter?.() !== false && stillOwned()) {
          dailyReminderPromptRendezvous(input.sessions).offer({
            sessionId: owner,
            rootKey: root.currentRoute.key,
            isCurrent: stillOwned,
          });
        }
      });
    }
    return 'opened' as const;
  };
}
