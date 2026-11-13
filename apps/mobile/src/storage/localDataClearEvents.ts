import { replyNotificationInvalidation } from '../replyNotifications/replyNotificationInvalidation';

type Listener = () => void;
export type LocalSourceDeletionOrigin = 'local' | 'healthkit';
export type SourceDeletionEvent = Parameters<typeof notifyLocalSourceDeleted>;
type SourceDeletionListener = (
  origin: LocalSourceDeletionOrigin,
  deletedRecordIds?: ReadonlySet<string>,
) => void;
const listeners = new Set<Listener>();
const sourceListeners = new Set<SourceDeletionListener>();

/** Notify in-memory owners after the authoritative local-data transaction commits. */
export function subscribeLocalDataClear(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** One failing observer must not turn an already committed deletion into a reported rollback. */
export function notifyLocalDataCleared() {
  replyNotificationInvalidation.invalidate();
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      /* Other owners must still clear their cached data. */
    }
  }
}

/** Revalidate visible derived content after an individual source transaction commits. */
export function subscribeLocalSourceDeletion(
  listener: SourceDeletionListener,
  onlyOrigin?: LocalSourceDeletionOrigin,
) {
  const subscription: SourceDeletionListener = (origin, ids) => {
    if (!onlyOrigin || origin === onlyOrigin) listener(origin, ids);
  };
  sourceListeners.add(subscription);
  return () => {
    sourceListeners.delete(subscription);
  };
}

export function notifyLocalSourceDeleted(
  origin: LocalSourceDeletionOrigin = 'local',
  deletedRecordIds?: ReadonlySet<string>,
) {
  replyNotificationInvalidation.invalidate();
  for (const listener of sourceListeners) {
    try {
      listener(origin, deletedRecordIds);
    } catch {
      /* A committed deletion cannot be rolled back by an observer. */
    }
  }
}
