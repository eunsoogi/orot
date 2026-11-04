import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import { createConversationTurnRetention } from './conversationTurnRetention';

type Storage = ReturnType<typeof createConversationArtifactStorage>;
type Turn = ReturnType<typeof createConversationTurnRetention>;
type Slot = {
  id: string;
  version: number;
  hidden: boolean;
  ready?: Promise<void>;
  turns: Set<Turn>;
};

/** Own durable session identities and invalidate turn leases across removal and undo. */
export function createConversationSessionRetention(input: {
  openStorage: () => Promise<Storage>;
  createId: () => string;
  now: () => string;
}) {
  const slots = new Map<number, Slot>();
  return {
    async beginTurn(id: number, signal: AbortSignal) {
      let slot = slots.get(id);
      if (!slot) {
        slot = {
          id: input.createId(),
          version: 0,
          hidden: false,
          turns: new Set(),
        };
        slots.set(id, slot);
      }
      if (slot.hidden || signal.aborted)
        throw new Error('Conversation is unavailable.');
      const current = slot;
      const version = current.version;
      const assertLease = () => {
        if (
          slots.get(id) !== current ||
          current.hidden ||
          current.version !== version ||
          signal.aborted
        )
          throw new Error('Conversation is unavailable.');
      };
      const storage = await input.openStorage();
      assertLease();
      if (!current.ready) {
        current.ready = (async () => {
          const generation = await storage.currentGeneration();
          await storage.createSession(current.id, generation);
        })().catch(error => {
          current.ready = undefined;
          throw error;
        });
      }
      await current.ready;
      assertLease();
      const turn = createConversationTurnRetention({
        storage,
        sessionId: current.id,
        turnId: input.createId(),
        createdAt: input.now(),
        sessionVersion: version,
      });
      current.turns.add(turn);
      return turn;
    },
    async hide(id: number) {
      const slot = slots.get(id);
      if (!slot) throw new Error('Conversation is unavailable.');
      slot.hidden = true;
      for (const turn of slot.turns) turn.discardRetry();
      const storage = await input.openStorage();
      const version = await storage.hideSession(slot.id, slot.version);
      return { id: slot.id, version };
    },
    async undo(id: number, handle: { id: string; version: number | null }) {
      const slot = slots.get(id);
      if (!slot || !slot.hidden || slot.id !== handle.id)
        throw new Error('Conversation is unavailable.');
      if (handle.version === null) {
        slots.delete(id);
        return;
      }
      const storage = await input.openStorage();
      slot.version = await storage.undoHiddenSession(slot.id, handle.version);
      slot.hidden = false;
    },
  };
}
