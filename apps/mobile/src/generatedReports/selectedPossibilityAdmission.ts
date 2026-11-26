import type { SqlDatabase } from '@orot/storage';
import { acquireIndependentReadEpoch } from '../storage/protectedReadEpoch';
import { watchSavedReportNativeProtection } from './savedReportNativeProtection';

export type SelectedPossibilityAdmission = Readonly<{
  isCurrentDatabase: (owner: SqlDatabase) => boolean;
  retireSelection: () => void;
}>;

/** Keep the exact opened view under native, route and SQL authority through paint. */
export function holdSelectedPossibilityAdmission(
  database: SqlDatabase,
  signal: AbortSignal,
  admission: SelectedPossibilityAdmission | undefined,
) {
  if (signal.aborted || !admission?.isCurrentDatabase(database)) return;
  const epoch = acquireIndependentReadEpoch(database);
  if (!epoch) return;
  const controller = new AbortController();
  let positive = false;
  let unsubscribe: (() => void) | undefined;
  const dispose = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    signal.removeEventListener('abort', dispose);
    unsubscribe?.();
    epoch.dispose();
  };
  const retire = () => {
    if (controller.signal.aborted) return;
    dispose();
    admission.retireSelection();
  };
  signal.addEventListener('abort', dispose, { once: true });
  const native = watchSavedReportNativeProtection(controller.signal, retire);
  unsubscribe = epoch.beforeDispatch(retire);
  if (!native || !unsubscribe) {
    dispose();
    return;
  }
  const current = () =>
    !signal.aborted &&
    !controller.signal.aborted &&
    native.current() &&
    admission.isCurrentDatabase(database) &&
    epoch.current();
  return {
    current,
    renderCurrent: () => positive && current(),
    async confirm() {
      if (!current() || !(await native.confirm()) || !current()) return false;
      positive = true;
      return true;
    },
    dispose,
  };
}
