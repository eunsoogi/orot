export interface WorkflowRunControl {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
}
// Optional deadlines cover queueing and graph work; explicit null keeps caller cancellation only.
export function createWorkflowRunControl(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number | null,
): WorkflowRunControl {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer =
    timeoutMs === null
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      callerSignal?.removeEventListener('abort', abortFromCaller);
      // A provider can retain a native tool callback between graph steps. Release it on
      // every terminal outcome without changing the caller's cancellation state.
      controller.abort();
    },
  };
}
