import { useCallback, useRef, useState } from 'react';
import type { DailyReportIdentity } from '@orot/domain';
import type { ConversationEntryContext } from './conversationIntent';
import type { createDailyReportFeature } from './dailyReportFeature';
import { retainDailyReportResult } from './retainDailyReportResult';

type Retain = (
  target: NonNullable<ConversationEntryContext['dailyReport']>,
) => Promise<void>;

/** Keep a committed run retryable until its conversation reference is stored. */
export function useReportResultCommit(
  feature: ReturnType<typeof createDailyReportFeature>,
  retain?: Retain,
) {
  const handler = useRef(retain);
  handler.current = retain;
  const pending = useRef<{
    identity: DailyReportIdentity;
    runId: string;
    retain: Retain;
  } | null>(null);
  const [status, setStatus] = useState<'ready' | 'pending' | 'failed'>('ready');
  const run = useCallback(async () => {
    const item = pending.current;
    if (!item) return;
    setStatus('pending');
    try {
      if (
        !(await retainDailyReportResult(
          feature,
          item.identity,
          item.runId,
          item.retain,
        ))
      )
        throw new Error('Report changed.');
      if (pending.current === item) {
        pending.current = null;
        setStatus('ready');
      }
    } catch {
      if (pending.current === item) setStatus('failed');
    }
  }, [feature]);
  const beginCaptured = useCallback(
    (
      identity: DailyReportIdentity,
      runId: string,
      selected: Retain | undefined,
    ) => {
      if (!selected) return;
      pending.current = { identity, runId, retain: selected };
      run().catch(() => {});
    },
    [run],
  );
  const begin = useCallback(
    (identity: DailyReportIdentity, runId: string) =>
      beginCaptured(identity, runId, handler.current),
    [beginCaptured],
  );
  const capture = useCallback(() => handler.current, []);
  return {
    status,
    begin,
    beginCaptured,
    capture,
    retry: run,
  } as const;
}
