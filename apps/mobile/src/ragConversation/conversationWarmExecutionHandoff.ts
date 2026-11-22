import type {
  ConversationExecutionAdapter,
  ConversationExecutionEvent,
  ConversationInterruptionReason,
} from './conversationExecutionLease';
import { startConversationPreparationExecution } from './conversationPreparationExecution';
import type { Turn } from './conversationLifetimeEntry';
import type { ConversationTurnReservation } from './conversationTurnReservations';

export type WarmExecutionHandoff = ReturnType<typeof warmExecutionHandoff>;
const carried = new WeakMap<Turn, NonNullable<WarmExecutionHandoff>>();

export function carryWarmExecution(turn: Turn, value: WarmExecutionHandoff) {
  if (value) carried.set(turn, value);
}
export function takeWarmExecution(turn: Turn) {
  const value = carried.get(turn);
  carried.delete(turn);
  return value;
}

/** Transfer the new warm preparation's native listener to the ordinary durable
 * lease callbacks. Only the exact protected commit may activate the relay. */
export function warmExecutionHandoff(
  execution: ConversationExecutionAdapter | undefined,
  owner: ConversationTurnReservation,
  signal: AbortSignal,
  current: () => boolean,
  stopPreparation: () => void,
) {
  if (!execution?.beginPreparation || execution.currentPhase?.() !== 'active')
    return undefined;
  let interrupt: ((reason: ConversationInterruptionReason) => void) | undefined;
  let receive: ((event: ConversationExecutionEvent) => void) | undefined;
  let finish: (() => void) | null = null;
  let terminal: ConversationInterruptionReason | undefined;
  let earlyState:
    Extract<ConversationExecutionEvent, { kind: 'continued' }> | undefined;
  const prep = startConversationPreparationExecution({
    owner,
    signal,
    current,
    begin: id => execution.beginPreparation!(id),
    isActive: id => execution.isActive(id),
    end: id => execution.end(id),
    subscribe: next =>
      execution.subscribe(event => {
        if (event.kind === 'continued' && event.requestId === owner.requestId)
          earlyState = event;
        next(event);
      }),
    onPreparationEnd: event => {
      terminal =
        event.kind === 'expired'
          ? (event.reason ?? 'expired')
          : 'protected-data';
      if (interrupt) interrupt(terminal);
      else stopPreparation();
    },
  });
  return {
    id: owner.requestId,
    started: prep.started,
    stillOwned: () => !terminal && current() && !signal.aborted,
    close: prep.close,
    fence(next: (reason: ConversationInterruptionReason) => void) {
      interrupt = next;
      if (terminal) next(terminal);
    },
    adapter(durableCurrent: () => boolean): ConversationExecutionAdapter {
      return {
        ...execution,
        begin: async id => {
          if (id !== owner.requestId || !receive) return false;
          finish = await prep.adopt(owner, durableCurrent, receive);
          return finish !== null;
        },
        subscribe: next => {
          receive = next;
          return () => {
            receive = undefined;
          };
        },
        end: () => {
          finish?.();
        },
      };
    },
    lastState: () => earlyState?.state,
  };
}
