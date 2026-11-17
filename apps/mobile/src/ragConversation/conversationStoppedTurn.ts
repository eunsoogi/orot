import { stopSettlement } from './conversationStopSettlement';
import { conversationBoundary } from './conversationFinalizationDiagnostics';
import { createExecutionDiagnostics } from './conversationExecutionDiagnostics';
import { coldPreviewPatch } from './replaceColdConversationAnswer';
import { t } from '../i18n';
import type { ConversationInterruptionReason } from './conversationExecutionLease';
import { getRagConversationCopy } from './copy';
import { restoreFailedPrompt, retainPartial } from './conversationFailedPrompt';
import type {
  ConversationSession,
  PendingTurn,
} from './conversationSessionTypes';
import type { createConversationRequestLifetime } from './conversationRequestLifetime';
import type { createConversationTurnActivity } from './conversationTurnActivity';

/** Keep partial display state bound to its original session. */
export function createRetainConversationPartial(
  find: (id: number) => ConversationSession,
  update: (id: number, change: Partial<ConversationSession>) => void,
  nextId: () => number,
) {
  return (id: number, activity: string, retainEmpty = false) =>
    retainPartial(find, update, nextId, id, activity, retainEmpty);
}

/** Keep the unfinished stream and distinguish an iOS interruption from an explicit stop. */
export function showStoppedConversationTurn(input: {
  id: number;
  status: 'cancelled' | 'interrupted';
  interruptionReason?: ConversationInterruptionReason;
  turn?: PendingTurn;
  find: (id: number) => ConversationSession;
  update: (id: number, change: Partial<ConversationSession>) => void;
  retainPartial: (id: number, activity: string, retainEmpty?: boolean) => void;
  current?: () => boolean;
}) {
  if (input.current?.() === false) return;
  const copy = getRagConversationCopy();
  if (input.turn?.coldResponseId !== undefined) {
    const session = input.find(input.id);
    input.update(input.id, {
      busy: false,
      pendingMessage: null,
      messages: session.messages.map(message =>
        message.id === input.turn!.coldResponseId
          ? {
              ...message,
              ...coldPreviewPatch(session, message),
              incomplete: true,
              coldResume: undefined,
              interruptionReason:
                input.interruptionReason ??
                (input.status === 'cancelled'
                  ? 'user-stopped'
                  : 'provider-failed'),
            }
          : message,
      ),
    });
    return;
  }
  input.retainPartial(
    input.id,
    input.status === 'interrupted'
      ? input.interruptionReason
        ? t(`conversationInterruption.${input.interruptionReason}`)
        : copy.progressInterrupted
      : copy.progressCancelled,
    true,
  );
  if (input.current?.() === false) return;
  if (input.status === 'interrupted') {
    const session = input.find(input.id);
    const last = session.messages.at(-1);
    if (last?.role === 'assistant' && last.incomplete)
      input.update(input.id, {
        messages: session.messages.map(message =>
          message === last
            ? {
                ...message,
                interruptionReason:
                  input.interruptionReason ?? 'provider-failed',
              }
            : message,
        ),
      });
  }
  if (input.current?.() === false) return;
  if (input.turn)
    restoreFailedPrompt(
      input.find,
      input.update,
      input.id,
      input.turn.question,
      input.turn.userMessageId,
      // The retained assistant activity already presents the interruption once.
      input.status === 'interrupted' ? '' : undefined,
      true,
      input.turn.restorePromptToComposer,
    );
  else input.update(input.id, { busy: false });
}

/** Abort one owner while allowing an already-started commit to settle first. */
export function createConversationStopHandler(input: {
  steering?: { clear: (id: number) => void; dispose: () => void };
  controllers: Map<number, AbortController>;
  pendingTurns: Map<number, PendingTurn>;
  activities: Map<number, ReturnType<typeof createConversationTurnActivity>>;
  snapshots: Map<
    number,
    ReturnType<
      typeof import('./conversationActivity').createConversationActivity
    >
  >;
  lifetime: ReturnType<typeof createConversationRequestLifetime>;
  find: (id: number) => ConversationSession;
  update: (id: number, change: Partial<ConversationSession>) => void;
  retainPartial: (id: number, activity: string, retainEmpty?: boolean) => void;
}) {
  // Stop timing uses a separate bounded sequence per controller, not private request identifiers.
  // Unknown phase is intentional: a tap is not evidence of the OS lifecycle state.
  const stopDiagnostics = new WeakMap<
    AbortController,
    ReturnType<typeof createExecutionDiagnostics>
  >();
  // Synchronous callbacks cannot redirect this Stop to a replacement in the same session.
  // Retain same-owner settlement, then release the guard before the next user event.
  const stopping = new Map<
    number,
    { controller: AbortController; settled: boolean }
  >();
  return (
    id: number,
    settled = false,
    reason: 'cancelled' | 'interrupted' = 'cancelled',
  ) => {
    const controller = input.controllers.get(id);
    if (!controller) return;
    const active = stopping.get(id);
    if (active) {
      if (active.controller === controller && settled) active.settled = true;
      return;
    }
    const cleanup = { controller, settled };
    stopping.set(id, cleanup);
    try {
      const current = () => {
        if (input.controllers.get(id) === controller) return true;
        // Cancel only the captured detached request; never interrupt a newer lifetime by ID.
        controller.abort();
        return false;
      };
      const status = input.lifetime.status(id, controller) ?? reason;
      // Lifecycle interruptions share this cleanup path but are not user Stop latency.
      let diagnose =
        status === 'cancelled' ? stopDiagnostics.get(controller) : undefined;
      if (status === 'cancelled' && !diagnose) {
        diagnose = createExecutionDiagnostics(undefined, () => 'unknown');
        stopDiagnostics.set(controller, diagnose);
        diagnose('stop-received');
      }
      const turn = input.pendingTurns.get(id);
      const snapshot = input.snapshots.get(id);
      snapshot?.cancel();
      if (snapshot)
        input.update(id, { requestActivity: snapshot.getSnapshot() });
      if (!current()) return;
      if (status === 'cancelled') turn?.stopCold?.();
      if (!current()) return;
      input.lifetime.interrupt(id, status);
      if (!current()) return;
      controller.abort();
      // An abort observer may supersede the UI owner; never clear the replacement.
      if (!current()) return;
      diagnose?.('abort-dispatched');
      if (diagnose) conversationBoundary('stop_abort', 'completed');
      input.steering?.clear(id);
      if (!current()) return;
      // System interruption is not an explicit user cancellation; persist the true state.
      input.activities.get(id)?.finish(status);
      if (!current()) return;
      if (
        (turn?.coldStopping ||
          turn?.saving ||
          turn?.summarySaving ||
          turn?.summaryCommitted) &&
        !cleanup.settled
      ) {
        diagnose?.('stop-awaiting-commit');
        if (diagnose) stopSettlement.start(controller);
        return;
      }
      input.controllers.delete(id);
      input.pendingTurns.delete(id);
      snapshot?.settle();
      if (input.snapshots.get(id) === snapshot) input.snapshots.delete(id);
      stopSettlement.finish(controller);
      input.update(id, { artifactContinuation: null, requestActivity: null });
      const noReplacement = () => !input.controllers.has(id);
      if (!noReplacement()) return;
      showStoppedConversationTurn({
        ...input,
        id,
        status,
        turn,
        interruptionReason: input.lifetime.interruptionReason(controller),
        current: noReplacement,
      });
      diagnose?.('stop-presented');
      stopSettlement.finish(controller);
    } finally {
      stopping.delete(id);
    }
  };
}
