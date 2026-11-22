import { conversationCompletedAnswer } from './conversationCompletedAnswer';
import type { DailyReportMemoryTap } from '../storage/dailyReportMemoryTap';
import type { ConversationRetentionCandidate } from './conversationRetention';
import type { PendingTurn } from './conversationSessionTypes';

type Report = NonNullable<ConversationRetentionCandidate['dailyReport']>;
type Job = (current: () => boolean) => Promise<boolean>;
const taps = new WeakMap<object, DailyReportMemoryTap>();
const staged = new WeakMap<PendingTurn, Job>();
const running = new Map<PendingTurn, ReturnType<typeof setTimeout>>();
const jobLimit = 30_000;
const capacity = 4;

/** The local capability is never included in the observer passed into a model. */
export function bindDailyReportMemoryTap(
  observer: object,
  tap: DailyReportMemoryTap,
) {
  taps.set(observer, tap);
}
export function dailyReportMemoryTapFor(observer?: object) {
  const tap = observer && taps.get(observer);
  return tap?.current() ? tap : undefined;
}

export type DailyReportMemoryObserver = (
  tap: DailyReportMemoryTap,
) => ((report: Report) => void) | undefined;

export function stageDailyReportMemory(request: PendingTurn, job: Job) {
  if (!request.committed || staged.has(request) || running.has(request)) return;
  staged.set(request, job);
}

/** The request hands off its one local job only after the answer is rendered in state.
 * A slow native call cannot hold the answer, and a timed-out job loses write authority. */
export function startDisplayedDailyReportMemory(request: PendingTurn) {
  const job = staged.get(request);
  staged.delete(request);
  if (!job || running.has(request) || running.size >= capacity) return;
  const expiry = setTimeout(() => running.delete(request), jobLimit);
  running.set(request, expiry);
  // Yield a separate task so optional work starts after ordinary completion.
  setTimeout(() => {
    const current = () => running.get(request) === expiry;
    Promise.resolve()
      .then(() => current() && job(current))
      .catch(() => {})
      .finally(() => {
        clearTimeout(expiry);
        if (current()) running.delete(request);
      });
  }, 0);
}

/** Publish ordinary state first; the tracked optional write is not on its critical path. */
export function publishConversationAnswer(
  request: PendingTurn,
  input: Parameters<typeof conversationCompletedAnswer>[0],
) {
  conversationCompletedAnswer(input);
  if (input.outcome.status === 'answer' && request.committed)
    startDisplayedDailyReportMemory(request);
}
