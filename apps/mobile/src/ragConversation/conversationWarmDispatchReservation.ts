import type {
  ConversationSender,
  ConversationSession,
  ConversationSessionOptions,
} from './conversationSessionTypes';
import {
  carryWarmExecution,
  warmExecutionHandoff,
  type WarmExecutionHandoff,
} from './conversationWarmExecutionHandoff';
import type { ConversationTurnReservation } from './conversationTurnReservations';

const planned = new WeakMap<
  ConversationSender,
  {
    reservation: ConversationTurnReservation;
    close: () => void;
    execution?: WarmExecutionHandoff;
  }
>();

/** Attach only the current app-owned reservation to this one dispatch invocation. */
export function bindWarmDispatchReservation(
  sender: ConversationSender,
  reservation: ConversationTurnReservation,
  close: () => void,
  execution?: WarmExecutionHandoff,
): ConversationSender {
  const owned: ConversationSender = (...args) => sender(...args);
  planned.set(owned, { reservation, close, execution });
  return owned;
}

export function takeWarmDispatchReservation(sender: ConversationSender) {
  const reservation = planned.get(sender);
  planned.delete(sender);
  return reservation;
}

export function prepareWarmDispatchReservation(
  options: Pick<
    ConversationSessionOptions,
    'captureWarmExecution' | 'retention'
  >,
  id: number,
  signal: AbortSignal,
  current: () => boolean,
) {
  const lease = options.retention?.activeLease(id);
  if (!lease || !options.retention?.reserveWarmTurn) return null;
  const witness = options.captureWarmExecution?.(lease);
  if (!witness || !witness() || !current()) return null;
  const owns = () => current() && witness();
  const reservation = options.retention.reserveWarmTurn(
    id,
    lease,
    signal,
    owns,
  );
  return reservation ? { reservation, owns } : null;
}

/** Preserve the legacy two-argument port when a dispatch has no warm reservation. */
export async function beginWarmDispatchTurn(
  retention: ConversationSessionOptions['retention'],
  id: number,
  signal: AbortSignal,
  sender: ConversationSender,
) {
  const plannedTurn = takeWarmDispatchReservation(sender);
  if (!plannedTurn) return retention?.beginTurn(id, signal);
  // Keep the same close hook until the dispatcher drains. An abort during
  // the durable write, not just during beginTurn, must end unpromoted work now.
  signal.addEventListener('abort', plannedTurn.close, { once: true });
  if (signal.aborted) {
    plannedTurn.close();
    return undefined;
  }
  const turn = await retention?.beginTurn(id, signal, plannedTurn.reservation);
  if (turn) carryWarmExecution(turn, plannedTurn.execution);
  return turn;
}

/** Keep exact selection ownership from early preparation to the durable lookup. */
export function prepareWarmDispatchRoute(
  input: {
    options?: Pick<
      ConversationSessionOptions,
      'retention' | 'captureWarmExecution' | 'execution'
    >;
    selection?: {
      epoch: { selection: number };
      subscribe: (listener: () => void) => () => void;
    };
    disposed: () => boolean;
    current: (id: number) => boolean;
    find: (id: number) => ConversationSession | undefined;
  },
  id: number,
  controller: AbortController,
  signal: AbortSignal,
) {
  if (!input.options) return;
  const epoch = input.selection?.epoch.selection;
  const plan = prepareWarmDispatchReservation(input.options, id, signal, () => {
    const owner = input.find(id);
    return (
      !controller.signal.aborted &&
      !input.disposed() &&
      input.current(id) &&
      input.selection?.epoch.selection === epoch &&
      !!owner &&
      !owner.quarantined
    );
  });
  if (!plan) return;
  const stopWatching = input.selection?.subscribe(() => {
    if (!plan.owns()) controller.abort();
  });
  const early = warmExecutionHandoff(
    input.options.execution,
    plan.reservation,
    signal,
    plan.owns,
    () => controller.abort(),
  );
  return { reservation: plan.reservation, early, stopWatching };
}
