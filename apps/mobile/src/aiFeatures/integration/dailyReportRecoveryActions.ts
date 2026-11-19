import { readDailyReportRecoveryOwner } from '../../agent/execution/dailyReportRecoveryOwner';
import { createDailyReportRecoveryActionsReader } from './dailyReportRecoveryActionsReader';

export type { DailyReportRecoveryTarget } from './dailyReportRecoveryActionsReader';

/** Application recovery always uses the real protected-store owner. Pending metadata
 * and feature callers cannot choose a different authority or bypass its checks. */
export const createDailyReportRecoveryActions =
  createDailyReportRecoveryActionsReader(readDailyReportRecoveryOwner);
