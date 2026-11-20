import type { ConversationSessions } from '../ragConversation/conversationSessions';
import type { ConversationSessionOptions } from '../ragConversation/conversationSessionTypes';
import type { DailyReminderEntry } from './dailyReminderDelivery';
import {
  dailyReminderIntentStore,
  validDailyReminderConversationOwner,
} from './dailyReminderIntentStore';

/** Bind before card persistence so a retry cannot move one notification into another session. */
export function createDailyReminderConversationOwner(input: {
  sessions: ConversationSessions;
  retention?: ConversationSessionOptions['retention'];
  isCurrent: () => boolean;
  signal: AbortSignal;
}) {
  // Only standalone memory-only callers use numeric identities; production never downgrades.
  const memoryOwners = new Map<string, number>();
  function assertCurrent() {
    if (input.signal.aborted || !input.isCurrent())
      throw new Error('Reminder owner is no longer current.');
  }
  function available(id: number) {
    assertCurrent();
    const session = input.sessions
      .getSnapshot()
      .sessions.find(value => value.id === id);
    if (
      !session ||
      session.restoring ||
      session.restoreFailed ||
      session.quarantined ||
      session.busy
    )
      throw new Error('Reminder conversation is unavailable.');
    return session;
  }
  return async (entry: DailyReminderEntry): Promise<number> => {
    assertCurrent();
    let owner = entry.conversationOwner;
    if (owner !== undefined && !validDailyReminderConversationOwner(owner))
      throw new Error('Invalid reminder conversation owner');
    const retention = input.retention;
    if (!retention) {
      if (owner) throw new Error('Protected reminder storage is unavailable.');
      const id =
        memoryOwners.get(entry.entryKey) ??
        input.sessions.getSnapshot().activeId;
      available(id);
      memoryOwners.set(entry.entryKey, id);
      return id;
    }
    if (!owner) {
      const id = input.sessions.getSnapshot().activeId;
      const session = available(id);
      if (!retention.beginSession)
        throw new Error('Protected reminder storage is unavailable.');
      const lease = await retention.beginSession(id, input.signal);
      available(id);
      const activeLease = retention.activeLease(id);
      if (activeLease?.id !== lease.id || activeLease.version !== lease.version)
        throw new Error('Reminder conversation lease changed.');
      owner = { ...lease, createdAt: session.createdAt };
      if (!validDailyReminderConversationOwner(owner))
        throw new Error('Invalid reminder conversation owner');
      // Called inside the destination's serial transaction, before any task card can be saved.
      await dailyReminderIntentStore.write({
        entry: { ...entry, conversationOwner: owner },
        active: true,
      });
      available(id);
      const committedLease = retention.activeLease(id);
      if (
        committedLease?.id !== owner.id ||
        committedLease.version !== owner.version
      )
        throw new Error('Reminder conversation lease changed.');
      return id;
    }
    const existing = input.sessions.getSnapshot().sessions.find(session => {
      const lease = retention.activeLease(session.id);
      return lease?.id === owner.id && lease.version === owner.version;
    });
    const id =
      existing?.id ??
      (await input.sessions.attachExisting(
        owner.id,
        owner.version,
        owner.createdAt,
        false,
        input.isCurrent,
        input.signal,
      ));
    available(id);
    const lease = retention.activeLease(id);
    if (lease?.id !== owner.id || lease.version !== owner.version)
      throw new Error('Reminder conversation lease changed.');
    return id;
  };
}
