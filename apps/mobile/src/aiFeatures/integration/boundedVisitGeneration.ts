import { EVIDENCE_WORKFLOW_BUDGET } from '../../agent/evidenceWorkflowBudget';
import { nextVisitQuestionsCopy as copy } from '../../nextVisitQuestions/copy';
import { providerDiagnostic } from '../../providers/diagnostics';

/** User cancellation covers preparation and inference; optional finite deadlines serve explicit callers. */
export async function boundedVisitGeneration<T>(
  caller: AbortSignal,
  work: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number | null = EVIDENCE_WORKFLOW_BUDGET.timeoutMs,
): Promise<
  T | { status: 'cancelled' } | { status: 'unavailable'; message: string }
> {
  if (caller.aborted) return { status: 'cancelled' };
  const controller = new AbortController();
  let timedOut = false;
  let stop!: () => void;
  const stopped = new Promise<void>(resolve => {
    stop = resolve;
  });
  const abort = () => {
    controller.abort();
    stop();
  };
  caller.addEventListener('abort', abort, { once: true });
  const timer =
    timeoutMs === null
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          providerDiagnostic('visit', 'workflow', 'budget_exceeded');
          abort();
        }, timeoutMs);
  try {
    const result = await Promise.race([
      work(controller.signal),
      stopped.then(() =>
        timedOut
          ? {
              status: 'unavailable' as const,
              message: copy.generation.genericError,
            }
          : { status: 'cancelled' as const },
      ),
    ]);
    // Native cancellation may settle work in the same microtask; the enclosing deadline still wins.
    return timedOut
      ? { status: 'unavailable', message: copy.generation.genericError }
      : caller.aborted
        ? { status: 'cancelled' }
        : result;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    caller.removeEventListener('abort', abort);
    // Even a rejected operation must not retain permission to publish late state changes.
    controller.abort();
  }
}
