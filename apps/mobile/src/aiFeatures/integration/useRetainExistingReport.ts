import { useEffect, useRef, useState } from 'react';
import type { ConversationEntryContext } from './conversationIntent';
import type { useDailyReportRoute } from './useDailyReportRoute';

type Report = NonNullable<ConversationEntryContext['dailyReport']>;

/** A date-only task becomes an exact reference before a replacement may start. */
export function useRetainExistingReport(
  lookup: ReturnType<typeof useDailyReportRoute>['lookup'],
  expected: Report | undefined,
  taskRevision: number | undefined,
  retain?: (target: Report) => Promise<void>,
) {
  const currentRetain = useRef(retain);
  currentRetain.current = retain;
  const [attempt, setAttempt] = useState(0);
  const [settled, setSettled] = useState<{ key: string; ok: boolean } | null>(
    null,
  );
  const key =
    lookup?.status === 'saved' && taskRevision !== undefined
      ? `${lookup.runId}:${lookup.revision}:${taskRevision}`
      : null;
  useEffect(() => {
    if (
      expected ||
      lookup?.status !== 'saved' ||
      !currentRetain.current ||
      !key
    )
      return;
    let current = true;
    setSettled(null);
    currentRetain
      .current({
        identity: lookup.context.identity,
        runId: lookup.runId,
        revision: lookup.revision,
      })
      .then(
        () => {
          if (current) setSettled({ key, ok: true });
        },
        () => {
          if (current) setSettled({ key, ok: false });
        },
      );
    return () => {
      current = false;
    };
  }, [lookup, expected, key, attempt]);
  const status =
    !retain || expected || lookup?.status !== 'saved'
      ? 'ready'
      : !key || settled?.key !== key
        ? 'pending'
        : settled.ok
          ? 'ready'
          : 'failed';
  return { status, retry: () => setAttempt(value => value + 1) } as const;
}
