import type { ConversationRetentionSlot } from './conversationSessionTurns';

type Lease = Readonly<{ id: string; version: number }>;
export type ConversationTurnReservation = Readonly<{
  requestId: string;
  sessionId: string;
  revision: number;
}>;

/** A warm send may reserve one opaque ID, but cannot attach storage or replay it. */
export function createConversationTurnReservations(input: {
  slot: (id: number) => ConversationRetentionSlot | undefined;
  createId: () => string;
}) {
  // A handoff carries the original object, never an equal-looking tuple.
  const reserved = new WeakMap<
    ConversationRetentionSlot,
    {
      value: ConversationTurnReservation;
      signal: AbortSignal;
      current: () => boolean;
      cancel: () => void;
    }
  >();
  return {
    reserve(
      id: number,
      lease: Lease,
      signal: AbortSignal,
      current: () => boolean,
    ) {
      const slot = input.slot(id);
      if (
        !slot ||
        slot.hidden ||
        slot.id !== lease.id ||
        slot.version !== lease.version ||
        reserved.has(slot) ||
        signal.aborted ||
        !current()
      )
        return null;
      const value = Object.freeze({
        requestId: input.createId(),
        sessionId: lease.id,
        revision: lease.version,
      });
      const cancel = () => {
        if (reserved.get(slot)?.value === value) reserved.delete(slot);
        signal.removeEventListener('abort', cancel);
      };
      reserved.set(slot, { value, cancel, signal, current });
      signal.addEventListener('abort', cancel, { once: true });
      return value;
    },
    consume(
      id: number,
      slot: ConversationRetentionSlot,
      value: ConversationTurnReservation,
    ) {
      const owner = reserved.get(slot);
      if (owner?.value !== value) return null;
      owner.cancel(); // Failure is terminal for this reservation, too.
      if (
        input.slot(id) !== slot ||
        slot.hidden ||
        slot.id !== value.sessionId ||
        slot.version !== value.revision ||
        owner.signal.aborted ||
        !owner.current()
      )
        return null;
      return value.requestId;
    },
  };
}
