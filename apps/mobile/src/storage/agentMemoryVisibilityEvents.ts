import type { SqlDatabase } from '@orot/storage';
import { protectedDatabaseOwnerIdentity } from './protectedReadEpoch';

const listeners = new WeakMap<object, Set<() => void>>();

/** Bind an opt-in caller to its own guarded connection and its current route lease. */
export function subscribeAgentMemoryVisibility(
  database: SqlDatabase,
  isCurrent: () => boolean,
  invalidate: () => void,
): () => void {
  const owner = protectedDatabaseOwnerIdentity(database);
  if (!owner) return () => {};
  const group = listeners.get(owner) ?? new Set<() => void>();
  listeners.set(owner, group);
  const invoke = () => {
    if (isCurrent()) invalidate();
  };
  group.add(invoke);
  return () => {
    group.delete(invoke);
  };
}

/** Call only after a changed outer transaction settles successfully. */
export function notifyCommittedAgentMemoryVisibility(
  database: SqlDatabase,
): void {
  const owner = protectedDatabaseOwnerIdentity(database);
  if (!owner) return;
  const group = listeners.get(owner);
  if (!group) return;
  for (const listener of [...group]) {
    if (!group.has(listener)) continue;
    try {
      listener();
    } catch {
      /* An observer cannot unwind the durable commit. */
    }
  }
}
