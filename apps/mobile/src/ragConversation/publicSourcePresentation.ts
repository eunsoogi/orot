const presentationFallbackMs = 450;

/** Prefer the native presentation receipt; an absent receipt cannot stall verification. */
export function waitForPublicSourcePresentation(signal: AbortSignal) {
  let shown = () => {};
  const ready = new Promise<boolean>(resolve => {
    if (signal.aborted) {
      resolve(false);
      return;
    }
    let pending = true;
    const finish = (mayRead: boolean) => {
      if (!pending) return;
      pending = false;
      clearTimeout(fallback);
      signal.removeEventListener('abort', abort);
      resolve(mayRead && !signal.aborted);
    };
    const abort = () => finish(false);
    const fallback = setTimeout(() => finish(true), presentationFallbackMs);
    shown = () => finish(true);
    signal.addEventListener('abort', abort, { once: true });
  });
  return { ready, shown };
}
