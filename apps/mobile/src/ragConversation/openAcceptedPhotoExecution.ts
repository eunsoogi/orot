import {
  beginConversationExecutionLease,
  type ConversationExecutionAdapter,
  type ConversationInterruptionReason,
} from './conversationExecutionLease';

/** Borrow the existing bounded UIKit lease for one approved direct-image send.
 * A denied request may use its unchanged foreground path; it cannot borrow
 * background authority. This adapter never requests continued-processing work. */
export async function openAcceptedPhotoExecution(input: {
  readonly adapter?: ConversationExecutionAdapter | null;
  readonly requestId: string;
  readonly signal: AbortSignal;
  readonly foregroundOwner: () => boolean;
  readonly requestOwner: () => boolean;
  readonly interrupt: (reason: ConversationInterruptionReason) => void;
}) {
  const {
    adapter,
    requestId,
    signal,
    foregroundOwner,
    requestOwner,
    interrupt,
  } = input;
  if (
    !adapter?.bridgeAvailable ||
    signal.aborted ||
    adapter.currentPhase?.() !== 'active' ||
    !foregroundOwner()
  )
    return;
  let admitted = false;
  let invalidated = false;
  let release: (() => void) | undefined;
  const close = () => {
    invalidated = true;
    signal.removeEventListener('abort', close);
    release?.();
  };
  const current = () =>
    admitted && !invalidated && !signal.aborted && requestOwner();
  signal.addEventListener('abort', close, { once: true });
  try {
    if (
      (await adapter.protectedDataAvailable()) !== true ||
      signal.aborted ||
      invalidated ||
      !foregroundOwner() ||
      adapter.currentPhase?.() !== 'active'
    ) {
      close();
      return;
    }
    const lease = await beginConversationExecutionLease(
      adapter,
      requestId,
      reason => {
        const published = admitted && !invalidated && !signal.aborted;
        close();
        if (published && requestOwner()) interrupt(reason);
      },
    );
    release = lease;
    if (
      !lease.admitted ||
      invalidated ||
      signal.aborted ||
      !foregroundOwner() ||
      adapter.currentPhase?.() !== 'active'
    ) {
      close();
      return;
    }
    admitted = true;
    return {
      current,
      async recheck() {
        try {
          return (
            current() &&
            (await adapter.protectedDataAvailable()) === true &&
            current() &&
            (await adapter.isActive(requestId)) === true &&
            current()
          );
        } catch {
          return false;
        }
      },
      close,
    };
  } catch {
    close();
    return;
  }
}
