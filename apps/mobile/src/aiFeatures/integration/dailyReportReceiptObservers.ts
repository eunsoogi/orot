import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { ConversationProviderReceipt } from './conversationReceiptProvider';

/** Share only an observed receipt for this one operation, never text, consent or retained sources. */
export function dailyReportReceiptObservers(operationSignal: AbortSignal) {
  const observers = new Map<RagConversationObserver, () => void>();
  let latest: ConversationProviderReceipt | undefined;
  let closed = false;
  const deliver = (
    observer: RagConversationObserver,
    receipt: ConversationProviderReceipt,
  ) => {
    // Another observer may synchronously advance the operation during this broadcast.
    if (
      closed ||
      operationSignal.aborted ||
      !observers.has(observer) ||
      latest !== receipt
    )
      return;
    try {
      observer.onProviderReceipt?.(receipt);
    } catch {
      // One display observer cannot break generation or another request's receipt.
    }
  };
  const dispose = () => {
    closed = true;
    for (const remove of observers.values()) remove();
    observers.clear();
    operationSignal.removeEventListener('abort', dispose);
  };
  operationSignal.addEventListener('abort', dispose, { once: true });
  return {
    join(observer?: RagConversationObserver, signal?: AbortSignal) {
      if (
        !observer?.onProviderReceipt ||
        closed ||
        operationSignal.aborted ||
        signal?.aborted ||
        observers.has(observer)
      )
        return;
      const leave = () => {
        observers.get(observer)?.();
        observers.delete(observer);
      };
      observers.set(observer, () =>
        signal?.removeEventListener('abort', leave),
      );
      signal?.addEventListener('abort', leave, { once: true });
      // A late join gets only an observation already made by this exact live run.
      if (latest) deliver(observer, latest);
    },
    observe(receipt: ConversationProviderReceipt) {
      if (
        closed ||
        operationSignal.aborted ||
        latest === 'response_started' ||
        latest === receipt
      )
        return;
      latest = receipt;
      for (const observer of [...observers.keys()]) deliver(observer, receipt);
    },
    dispose,
  };
}
