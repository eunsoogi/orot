import { watchSavedReportNativeProtection } from '../generatedReports/savedReportNativeProtection';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';

/** One explicit archive tap; restored protection cannot revive an old save. */
export function captureArchivedSummaryBookmarkProtection() {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const clear = subscribeLocalDataClear(abort);
  const deleted = subscribeLocalSourceDeletion(abort);
  const native = watchSavedReportNativeProtection(controller.signal, abort);
  return {
    current: () => !controller.signal.aborted,
    confirmProtected: () => native?.confirm() ?? Promise.resolve(false),
    close() {
      abort();
      clear();
      deleted();
    },
  };
}
