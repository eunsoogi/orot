import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import { createConversationTurnRetention } from './conversationTurnRetention';
import type { ConversationToolEvent } from '@orot/agent-runtime';
import type { ToolLineage } from '../storage/conversationToolLineage';

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
  captureToolSources?: (event: ConversationToolEvent) => Promise<{
    event: ConversationToolEvent;
    dependencies: ToolLineage;
  }>;
}) {
  const slots = new Map<number, Slot>();
  let lifecycle = 0;
  return {
    invalidate() {
      lifecycle += 1;
      for (const slot of slots.values())
        for (const turn of slot.turns) turn.discardRetry();
      slots.clear();
    },
    activeIdentity(id: number) {
      const slot = slots.get(id);
      return slot && !slot.hidden ? slot.id : null;
    },
    activeLease(id: number) {
      const slot = slots.get(id);
      return slot && !slot.hidden
        ? { id: slot.id, version: slot.version }
        : null;
    },
    prepareRemoval(id: number) {
      const slot = slots.get(id);
      if (!slot) return;
      slot.hidden = true;
      for (const turn of slot.turns) turn.suspend();
    },
    async resumeIfActive(id: number) {
      const slot = slots.get(id);
      if (!slot) return null;
      const storage = await input.openStorage();
      if ((await storage.activeSessionVersion(slot.id)) !== slot.version)
        return null;
      slot.hidden = false;
      for (const turn of slot.turns) turn.resume();
      return slot.id;
    },
    async attachExisting(
      id: number,
      durableId: string,
      expectedVersion: number,
    ) {
      if (
        slots.has(id) ||
        !durableId ||
        !Number.isSafeInteger(expectedVersion) ||
        expectedVersion < 0
      )
        throw new Error('Conversation session state is invalid.');
      // A read started before a local-data clear must never attach its old result.
      const started = lifecycle;
      const storage = await input.openStorage();
      if (
        (await storage.activeSessionVersion(durableId)) !== expectedVersion ||
        started !== lifecycle ||
        slots.has(id) ||
        [...slots.values()].some(slot => slot.id === durableId)
      )
        throw new Error('Conversation is unavailable.');
      slots.set(id, {
        id: durableId,
        version: expectedVersion,
        hidden: false,
        ready: Promise.resolve(),
        turns: new Set(),
      });
    },
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
      if ((await storage.activeSessionVersion(current.id)) !== version)
        throw new Error('Conversation is unavailable.');
      assertLease();
      const turn = createConversationTurnRetention({
        storage,
        sessionId: current.id,
        turnId: input.createId(),
        createdAt: input.now(),
        sessionVersion: version,
        captureToolSources: input.captureToolSources,
      });
      current.turns.add(turn);
      return turn;
    },
    async hide(id: number) {
      const slot = slots.get(id);
      if (!slot) return null;
      slot.hidden = true;
      const storage = await input.openStorage();
      const version = await storage.hideSession(slot.id, slot.version);
      for (const turn of slot.turns) turn.discardRetry();
      return { id: slot.id, version };
    },
    async undo(
      id: number,
      handle: { id: string; version: number | null } | null,
    ) {
      if (!handle) return;
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
    async finalize(handle: { id: string; version: number | null } | null) {
      if (handle?.version == null) return;
      const storage = await input.openStorage();
      await storage.finalizeHiddenSession(handle.id, handle.version);
    },
  };
}
