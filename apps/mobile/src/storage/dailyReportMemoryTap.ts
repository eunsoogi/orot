import type { SqlDatabase } from '@orot/storage';

/** An already observed pair; admission never waits or discovers a grant at tap time. */
export type DailyReportMemoryTap = Readonly<{
  database: SqlDatabase;
  sqlGeneration: number;
  deviceGeneration: string;
  current: () => boolean;
}>;
let ready: DailyReportMemoryTap | undefined;
let epoch = 0;

export function publishDailyReportMemoryTap(value?: DailyReportMemoryTap) {
  if (
    value &&
    ready?.current() &&
    ready.database === value.database &&
    ready.sqlGeneration === value.sqlGeneration &&
    ready.deviceGeneration === value.deviceGeneration
  )
    return;
  const observed = ++epoch;
  ready = value && {
    ...value,
    current: () => observed === epoch && value.current(),
  };
}

export function captureDailyReportMemoryTap():
  DailyReportMemoryTap | undefined {
  return ready?.current() ? ready : undefined;
}
