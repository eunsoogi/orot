import type { LanguageModelRequest } from '@orot/model-runtime';
import type { createSteeringQueue, SteeringBatch } from './steeringQueue';

type Queue = ReturnType<typeof createSteeringQueue>;
export type SteeringBoundaryResult =
  | { readonly status: 'unchanged'; readonly request: LanguageModelRequest }
  | {
      readonly status: 'prepared';
      readonly request: LanguageModelRequest;
      readonly batch: SteeringBatch;
    }
  | { readonly status: 'blocked' };

/**
 * Prepares only a subsequent model payload, not dispatch or consent.
 * The owner must atomically bind this payload in protected storage, then run
 * existing evidence, approval and provider-intent checks. Never skip those
 * checks or call this with a model/tool operation whose outcome is unknown.
 */
export async function prepareSteeringBoundary(input: {
  readonly owner: string;
  readonly queue: Queue;
  readonly request: LanguageModelRequest;
  readonly signal: AbortSignal;
  readonly pendingOperation: boolean;
  readonly paused: boolean;
  readonly bindProtectedRevision: (binding: {
    readonly owner: string;
    readonly batch: SteeringBatch;
    readonly request: LanguageModelRequest;
    readonly signal: AbortSignal;
  }) => Promise<boolean>;
}): Promise<SteeringBoundaryResult> {
  if (input.signal.aborted) {
    input.queue.close(input.owner);
    return { status: 'blocked' };
  }
  if (input.pendingOperation || input.paused || !input.queue.acceptsBoundary(input.owner))
    return { status: 'blocked' };
  const batch = input.queue.prepare(input.owner);
  if (!batch) {
    // A prepared revision cannot be silently skipped or replayed.
    if (input.queue.snapshot().some((instruction) => instruction.status === 'prepared'))
      return { status: 'blocked' };
    return { status: 'unchanged', request: input.request };
  }
  const request: LanguageModelRequest = {
    ...input.request,
    messages: [
      ...input.request.messages,
      ...batch.instructions.map((instruction) => ({
        role: 'user' as const,
        content: instruction.text,
      })),
    ],
  };
  try {
    const snapshot = JSON.stringify({ batch, request });
    const bound = await input.bindProtectedRevision({
      owner: input.owner,
      batch,
      request,
      signal: input.signal,
    });
    if (
      bound &&
      !input.signal.aborted &&
      input.queue.ownsPrepared(input.owner, batch.revision) &&
      snapshot === JSON.stringify({ batch, request })
    )
      return { status: 'prepared', request, batch };
  } catch {
    // Journal errors may contain private payloads; expose only a closed state.
  }
  input.queue.close(input.owner);
  return { status: 'blocked' };
}
