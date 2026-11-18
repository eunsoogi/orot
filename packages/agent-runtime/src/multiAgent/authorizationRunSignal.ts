// This map owns only cancellation state, never an authorization verdict, request,
// payload or source snapshot. Exact workflow signal identity is also the native
// Apple tool-continuation boundary, so all calls in that run must see one child.
const runs = new WeakMap<AbortSignal, AbortController>();

export function authorizationRunSignal(parent?: AbortSignal): AbortController {
  if (!parent) return new AbortController();
  const existing = runs.get(parent);
  if (existing) return existing;
  const controller = new AbortController();
  runs.set(parent, controller);
  const abort = () => controller.abort();
  parent.addEventListener('abort', abort, { once: true });
  controller.signal.addEventListener(
    'abort',
    () => {
      parent.removeEventListener('abort', abort);
      // Keep the aborted child as a tombstone while parent is reachable. A caller
      // cannot revive a revoked run by asking for another provider invocation.
    },
    { once: true },
  );
  if (parent.aborted) abort();
  return controller;
}
