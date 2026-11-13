import { nativeReplyNotifications } from './nativeReplyNotifications';

let generation = 0;

/** Deletion invalidates in-flight previews even before conversation storage is opened. */
export const replyNotificationInvalidation = {
  capture: () => generation,
  isCurrent: (value: number) => value === generation,
  invalidate() {
    generation += 1;
    try {
      nativeReplyNotifications()
        .removeAll()
        .catch(() => undefined);
    } catch {
      // A missing bridge cannot roll back a committed local-data deletion.
    }
  },
};
