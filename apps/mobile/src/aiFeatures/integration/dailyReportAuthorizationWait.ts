import { createInitialReplyDeadline } from '@orot/agent-runtime';
import type { ExecutionConsentPort } from '@orot/agent-runtime';
import type { DailyReportDeadlineContext } from './dailyReportTypes';

type Deadline = ReturnType<typeof createInitialReplyDeadline>;
const waits = new WeakMap<
  DailyReportDeadlineContext,
  { count: number; deadlines: Set<Deadline> }
>();
function state(context: DailyReportDeadlineContext) {
  let current = waits.get(context);
  if (!current) {
    current = { count: 0, deadlines: new Set() };
    waits.set(context, current);
  }
  return current;
}

/** Optional finite callers count processing, not a person's decision; null installs no timer.
 * All timers retain spent time and unregister on settlement; Stop is never paused. */
export function reportProcessingDeadline(
  context: DailyReportDeadlineContext | undefined,
  expire: () => void,
  milliseconds: number | null,
) {
  const deadline = createInitialReplyDeadline(expire, milliseconds);
  const current = context ? state(context) : undefined;
  current?.deadlines.add(deadline);
  if (current?.count) deadline.pause();
  return {
    dispose() {
      current?.deadlines.delete(deadline);
      deadline.dispose();
    },
  };
}

/** Exact requests still reach the existing consent gate. Only explicit authorization
 * waits pause report timers, never source reads, provider work or persistence. */
export function reportConsent(
  consent: ExecutionConsentPort,
  context: DailyReportDeadlineContext,
): ExecutionConsentPort {
  return {
    // Preserve a settings-issued live dispatch fence through this wait adapter.
    ...(consent.subscribeAuthorizationInvalidation
      ? {
          subscribeAuthorizationInvalidation:
            consent.subscribeAuthorizationInvalidation.bind(consent),
        }
      : {}),
    ...(consent.isAuthorizationCurrent
      ? { isAuthorizationCurrent: consent.isAuthorizationCurrent.bind(consent) }
      : {}),
    async authorize(request) {
      const current = state(context);
      current.count++;
      for (const deadline of current.deadlines) deadline.pause();
      try {
        return await consent.authorize(request);
      } finally {
        current.count--;
        if (!current.count)
          for (const deadline of current.deadlines) deadline.resume();
      }
    },
  };
}
