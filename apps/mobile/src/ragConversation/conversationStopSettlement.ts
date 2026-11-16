import { conversationBoundary } from './conversationFinalizationDiagnostics';

// Pair a commit-wait observation with its owner's cleanup, including a commit that wins Stop.
// Weak ownership avoids retaining a request; no controller or request identity enters the sink.
const waiting = new WeakSet<AbortController>();
export const stopSettlement = {
  start(controller: AbortController) {
    if (waiting.has(controller)) return;
    waiting.add(controller);
    conversationBoundary('stop_settlement', 'started');
  },
  finish(controller: AbortController) {
    if (!waiting.delete(controller)) return;
    conversationBoundary('stop_settlement', 'completed');
  },
};
