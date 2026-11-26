import type { createWorkoutProtectionProbe } from '../healthkit/workoutProtectionProbe';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';

/** A warm encrypted handle and JS foreground do not prove native data access.
 * Bind one external tap or return read to positive protection and synchronous revocation. */
export function watchSavedReportNativeProtection(
  signal: AbortSignal,
  onLost: () => void,
  workoutProbe?: ReturnType<typeof createWorkoutProtectionProbe>,
) {
  if (signal.aborted) return undefined;
  let native: ReturnType<typeof conversationExecutionNative>;
  try {
    native = conversationExecutionNative();
  } catch {
    onLost();
    return undefined;
  }
  if (!native?.bridgeAvailable) {
    onLost();
    return undefined;
  }
  let closed = false;
  let unsubscribe: (() => void) | undefined;
  const dispose = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener('abort', dispose);
    unsubscribe?.();
  };
  const revoke = () => {
    if (closed) return;
    const cancelled = signal.aborted;
    dispose();
    if (!cancelled) onLost();
  };
  const current = () =>
    !closed && !signal.aborted && native.currentPhase?.() === 'active';
  signal.addEventListener('abort', dispose, { once: true });
  try {
    unsubscribe = native.subscribe(event => {
      if (
        event.kind === 'phase' ||
        (event.kind === 'protectedData' && !event.available)
      )
        revoke();
      else if (event.kind === 'protectedData') workoutProbe?.restored();
    });
  } catch {
    revoke();
    return undefined;
  }
  if (closed) {
    unsubscribe?.();
    return undefined;
  }
  return {
    current,
    dispose,
    async confirm() {
      if (!current()) {
        revoke();
        return false;
      }
      let positive: boolean | null = null;
      try {
        positive = await (workoutProbe
          ? workoutProbe.confirm(current, native.protectedDataAvailable)
          : native.protectedDataAvailable());
      } catch {
        // A rejected native probe carries no positive witness.
      }
      if (positive === true && current()) return true;
      revoke();
      return false;
    },
  };
}

/** Only the newly attested historical body requests a witness, but it stays
 * subscribed for the whole selected view; an aborted owner is never revived. */
export function savedHistoricalReadAdmission(
  signal: AbortSignal,
  onLost: () => void,
) {
  let watcher: ReturnType<typeof watchSavedReportNativeProtection>;
  return {
    async confirm() {
      if (signal.aborted) return false;
      watcher ??= watchSavedReportNativeProtection(signal, onLost);
      return watcher ? watcher.confirm() : false;
    },
    dispose() {
      watcher?.dispose();
    },
  };
}
