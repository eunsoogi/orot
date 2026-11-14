import type { createConversationArtifactStorage } from '../storage/conversationArtifactStorage';
import { createConversationTurnRetention } from './conversationTurnRetention';
type Storage = ReturnType<typeof createConversationArtifactStorage>;
type Turn = ReturnType<typeof createConversationTurnRetention>;
export type ConversationRetentionSlot = {
  id: string;
  version: number;
  hidden: boolean;
  ready?: Promise<void>;
  turns: Set<Turn>;
};

/** New turns allocate identities; adoption only attaches an already interrupted protected request. */
export function conversationSessionTurns(
  input: {
    ensureSession(
      id: number,
      signal: AbortSignal,
    ): Promise<{
      storage: Storage;
      current: ConversationRetentionSlot;
      version: number;
    }>;
    slot(id: number): ConversationRetentionSlot | undefined;
    openStorage(): Promise<Storage>;
    createId(): string;
    now(): string;
  } & Pick<
    Parameters<typeof createConversationTurnRetention>[0],
    'captureToolSources' | 'onToolEventStored'
  >,
) {
  const adoptions = new WeakMap<
    ConversationRetentionSlot,
    Map<string, { turn: Turn; signal: AbortSignal }>
  >();
  const turn = (
    storage: Storage,
    slot: ConversationRetentionSlot,
    id: string,
    createdAt: string,
    restored?: true,
    adapters?: Pick<
      Parameters<typeof createConversationTurnRetention>[0],
      'captureToolSources' | 'onToolEventStored'
    >,
  ) => {
    const value = createConversationTurnRetention({
      storage,
      sessionId: slot.id,
      sessionVersion: slot.version,
      turnId: id,
      createdAt,
      restored,
      captureToolSources: input.captureToolSources,
      onToolEventStored: input.onToolEventStored,
      ...adapters,
    });
    slot.turns.add(value);
    return value;
  };
  return {
    /** Release only the ended owner; pending save recovery remains attached to its original turn. */
    releaseAdoptedTurn(id: number, value: Turn) {
      const slot = input.slot(id);
      const owned = slot && adoptions.get(slot);
      const entry = owned?.get(value.toolMessageId);
      if (
        !entry ||
        entry.turn !== value ||
        !entry.signal.aborted ||
        value.hasPending()
      )
        return false;
      value.suspend();
      owned!.delete(value.toolMessageId);
      return true;
    },
    async beginTurn(id: number, signal: AbortSignal) {
      const { storage, current } = await input.ensureSession(id, signal);
      return turn(storage, current, input.createId(), input.now());
    },
    /** This is a local lifetime attachment, not execution permission; cold storage still claims atomically. */
    async adoptTurn(
      id: number,
      requestId: string,
      signal: AbortSignal,
      adapters?: Pick<
        Parameters<typeof createConversationTurnRetention>[0],
        'captureToolSources' | 'onToolEventStored'
      >,
    ) {
      const slot = input.slot(id);
      if (!slot || slot.hidden || signal.aborted)
        throw new Error('Existing conversation unavailable.');
      const version = slot.version;
      const storage = await input.openStorage();
      const request = (
        await storage.listInterruptedRequests(slot.id, version)
      ).find(value => value.id === requestId);
      const active = await storage.activeSessionVersion(slot.id);
      if (
        !request ||
        !['expired', 'decision-required'].includes(
          request.interruptionReason ?? '',
        ) ||
        request.submittedInput ||
        signal.aborted ||
        active !== version ||
        input.slot(id) !== slot ||
        slot.hidden ||
        slot.version !== version ||
        adoptions.get(slot)?.has(requestId)
      )
        throw new Error('Interrupted conversation cannot be adopted.');
      const value = turn(
        storage,
        slot,
        request.id,
        request.createdAt,
        true,
        adapters,
      );
      const owned = adoptions.get(slot) ?? new Map();
      owned.set(requestId, { turn: value, signal });
      adoptions.set(slot, owned);
      return value;
    },
  };
}
