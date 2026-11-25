import type { ToolCall } from '@orot/model-runtime';
import type { prepareRequest } from './request-mapper';

export type CompletedContinuation = Readonly<{
  text: string;
  toolCalls: readonly Readonly<{ id: string; name: string; arguments: string }>[];
  items: readonly string[];
}>;

const maxRememberedToolIDs = 256;

/** Request inputs contain no owning generation. An ID collision must not choose
 * either opaque completion; normalized authorized input remains available. */
export class CompletedContinuationCache {
  private readonly entries = new Map<string, CompletedContinuation | null>();
  private disabled = false;

  get(id: string) {
    return this.entries.get(id) ?? undefined;
  }

  choose(prepared: ReturnType<typeof prepareRequest>) {
    if (!prepared.ok || !prepared.withoutOpaque) return prepared;
    for (const [id, completion] of prepared.consumedContinuations)
      if (this.get(id) !== completion) return prepared.withoutOpaque;
    return prepared;
  }

  private remember(id: string, completion: CompletedContinuation | null) {
    if (this.disabled) return;
    if (this.entries.has(id)) {
      this.entries.set(id, null);
    } else if (this.entries.size >= maxRememberedToolIDs) {
      // Do not evict a retired ID and later accept it as a new authority.
      this.entries.clear();
      this.disabled = true;
    } else this.entries.set(id, completion);
  }

  settle(
    consumed: ReadonlyMap<string, CompletedContinuation>,
    toolCalls: readonly ToolCall[],
    event: { text: string; continuationItems?: readonly string[] },
  ) {
    if (toolCalls.length) {
      const completion: CompletedContinuation | null = event.continuationItems?.length
        ? {
            text: event.text,
            toolCalls: toolCalls.map((call) => ({
              id: call.id,
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            })),
            items: [...event.continuationItems],
          }
        : null;
      for (const { id } of toolCalls) this.remember(id, completion);
    } else {
      // Preserve the retired identity, but never its content after a final reply.
      for (const [id, completion] of consumed)
        if (this.get(id) === completion) this.entries.set(id, null);
    }
  }
}
