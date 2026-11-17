import type { ConversationLifetimeEntry } from './conversationLifetimeEntry';

const current = (
  entry: ConversationLifetimeEntry,
  entries: Map<number, ConversationLifetimeEntry>,
) =>
  entries.get(entry.id) === entry &&
  !entry.status &&
  !entry.controller.signal.aborted;

/** Keep only an advisory drain request, never a grant or permission to replay work. */
export function requestOwnedConversationPause(
  entry: ConversationLifetimeEntry,
  entries: Map<number, ConversationLifetimeEntry>,
) {
  if (!current(entry, entries)) return;
  if (entry.requestPause) entry.requestPause();
  else entry.pendingPause = true;
}

/** Preparation may finish after the OS requested a drain; deliver it to this owner only. */
export function registerConversationPause(
  entry: ConversationLifetimeEntry | undefined,
  entries: Map<number, ConversationLifetimeEntry>,
  requestPause: () => void,
) {
  if (!entry || !current(entry, entries)) return;
  entry.requestPause = requestPause;
  if (!entry.pendingPause) return;
  entry.pendingPause = false;
  requestPause();
}

/** A drained controller belongs to the old lease, not the next explicit continuation. */
export function clearDrainedConversationPause(
  entry: ConversationLifetimeEntry,
) {
  entry.requestPause = undefined;
  entry.pendingPause = false;
}
