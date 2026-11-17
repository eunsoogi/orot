export type SteeringStatus = 'queued' | 'prepared' | 'applied' | 'not_applied';
export interface SteeringInstruction {
  readonly id: string;
  readonly text: string;
  readonly sequence: number;
  readonly status: SteeringStatus;
}
export interface SteeringBatch {
  readonly revision: number;
  readonly instructions: readonly SteeringInstruction[];
}
export type SteeringEnqueueResult = 'queued' | 'duplicate' | 'rejected';

/**
 * Request-owned in-memory queue. It never dispatches or grants approval.
 * The continuation owner must persist a claimed batch in protected storage before
 * provider intent. Reconstructing this queue is not permission to replay a call.
 */
export function createSteeringQueue(owner: string) {
  let instructions: SteeringInstruction[] = [];
  let revision = 0;
  let prepared: SteeringBatch | undefined;
  let closed = false;
  const snapshot = () => instructions.map((instruction) => ({ ...instruction }));
  return {
    snapshot,
    acceptsBoundary(requestOwner: string): boolean {
      return !closed && requestOwner === owner && prepared === undefined;
    },
    ownsPrepared(requestOwner: string, batchRevision: number): boolean {
      return !closed && requestOwner === owner && prepared?.revision === batchRevision;
    },
    enqueue(requestOwner: string, id: string, text: string): SteeringEnqueueResult {
      if (closed || requestOwner !== owner || !id.trim() || !text.trim()) return 'rejected';
      const previous = instructions.find((instruction) => instruction.id === id);
      if (previous) return previous.text === text ? 'duplicate' : 'rejected';
      if (id.length > 128) return 'rejected';
      instructions.push({ id, text, sequence: instructions.length + 1, status: 'queued' });
      return 'queued';
    },
    /** Called only after the active provider/tool operation settles, before a new model request. */
    prepare(requestOwner: string): SteeringBatch | undefined {
      if (closed || requestOwner !== owner || prepared) return undefined;
      const queued = instructions.filter((instruction) => instruction.status === 'queued');
      if (!queued.length) return undefined;
      revision += 1;
      const ids = new Set(queued.map((instruction) => instruction.id));
      instructions = instructions.map((instruction) =>
        ids.has(instruction.id) ? { ...instruction, status: 'prepared' } : instruction,
      );
      prepared = {
        revision,
        instructions: instructions.filter((instruction) => ids.has(instruction.id)),
      };
      // Never expose the queue's mutable backing array to an observer or provider.
      return {
        revision,
        instructions: prepared.instructions.map((instruction) => ({ ...instruction })),
      };
    },
    /** Only a matching, durably observed provider receipt can acknowledge a batch. */
    acknowledge(requestOwner: string, consumedRevision: number): boolean {
      if (closed || requestOwner !== owner || prepared?.revision !== consumedRevision) return false;
      const ids = new Set(prepared.instructions.map((instruction) => instruction.id));
      instructions = instructions.map((instruction) =>
        ids.has(instruction.id) ? { ...instruction, status: 'applied' } : instruction,
      );
      prepared = undefined;
      return true;
    },
    /** Stop, failed reconstruction and terminal completion leave an honest delivery state. */
    close(requestOwner: string): void {
      if (requestOwner !== owner) return;
      closed = true;
      prepared = undefined;
      instructions = instructions.map((instruction) =>
        instruction.status === 'applied' ? instruction : { ...instruction, status: 'not_applied' },
      );
    },
    /** Deletion clears private text, including already consumed instructions. */
    clear(requestOwner: string): void {
      if (requestOwner !== owner) return;
      closed = true;
      prepared = undefined;
      instructions = [];
    },
  };
}
