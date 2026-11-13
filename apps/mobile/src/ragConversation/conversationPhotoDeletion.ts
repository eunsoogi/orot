import { subscribeLocalDataClear } from '../storage/localDataClearEvents';

/** A committed local-data clear hides in-memory drafts immediately; their owner retains cleanup failures for retry. */
export function observeConversationPhotoDeletion(drafts: {
  clear(): Promise<void>;
}) {
  return subscribeLocalDataClear(() => {
    drafts.clear().catch(() => {});
  });
}
