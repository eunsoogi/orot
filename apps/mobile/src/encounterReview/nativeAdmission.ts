import type { ConversationExecutionAdapter } from '../ragConversation/conversationExecutionLease';

type NativeProtection = Pick<
  ConversationExecutionAdapter,
  'bridgeAvailable' | 'currentPhase' | 'protectedDataAvailable' | 'subscribe'
>;

/** One saved-recording operation owns fresh positive native protection.
 * Once a lock, phase change or unknown probe revokes it, unlocking cannot revive it. */
export function watchEncounterNativeAdmission(
  native: NativeProtection | null,
  signal: AbortSignal,
  ownerCurrent: () => boolean,
) {
  if (!native?.bridgeAvailable || signal.aborted) return undefined;
  const controller = new AbortController();
  let unsubscribe: (() => void) | undefined;
  const dispose = () => {
    if (controller.signal.aborted) return;
    controller.abort();
    signal.removeEventListener('abort', dispose);
    unsubscribe?.();
  };
  const current = () => {
    try {
      return (
        !controller.signal.aborted &&
        !signal.aborted &&
        ownerCurrent() === true &&
        native.currentPhase?.() === 'active'
      );
    } catch {
      return false;
    }
  };
  signal.addEventListener('abort', dispose, { once: true });
  try {
    unsubscribe = native.subscribe(event => {
      if (
        event.kind === 'phase' ||
        (event.kind === 'protectedData' && !event.available)
      )
        dispose();
    });
  } catch {
    dispose();
  }
  if (controller.signal.aborted) unsubscribe?.();
  const probe = async () => {
    const operation = controller.signal;
    if (operation.aborted) return false;
    let stop = () => {};
    const retired = new Promise<false>(resolve => {
      stop = () => resolve(false);
      operation.addEventListener('abort', stop, { once: true });
    });
    try {
      return await Promise.race([native.protectedDataAvailable(), retired]);
    } finally {
      operation.removeEventListener('abort', stop);
    }
  };
  return {
    signal: controller.signal,
    dispose,
    async confirm() {
      if (current()) {
        try {
          if ((await probe()) === true && current()) return true;
        } catch {
          // A rejected native probe is not positive protection.
        }
      }
      dispose();
      return false;
    },
  };
}
