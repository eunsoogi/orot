import type { EvidenceChunk } from '../chunking';
import type { LocalEmbeddingVectorStore } from '../embeddingRetrieval';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import { CallbackManager, type Callbacks } from '@langchain/core/callbacks/manager';

/** Standard children may configure local/ambient handlers, but none may receive content. */
export class PrivateChildCallbacks extends CallbackManager {
  override copy(): CallbackManager {
    return new PrivateChildCallbacks();
  }
  override addHandler(): void {
    /* Reject local, verbose, tracing and configure-hook handlers. */
  }
}

/** Only call inside a private stream scope whose incoming callbacks were cleared first. */
export function callerStreamHandlers(callbacks?: Callbacks): BaseCallbackHandler[] {
  const handlers = Array.isArray(callbacks) ? callbacks : (callbacks?.handlers ?? []);
  // This recognizes the pinned library's internal handlers, not arbitrary observer identity.
  // Provenance comes from the inaccessible scope created by streamEvents/streamLog.
  return handlers.filter((handler): handler is BaseCallbackHandler => {
    const candidate = handler as {
      name?: unknown;
      receiveStream?: unknown;
      tapOutputIterable?: unknown;
    };
    return (
      handler instanceof BaseCallbackHandler &&
      (candidate.name === 'event_stream_tracer' || candidate.name === 'log_stream_tracer') &&
      candidate.receiveStream !== undefined &&
      typeof candidate.tapOutputIterable === 'function'
    );
  });
}

export type EvidenceRemovalReader = Pick<LocalEmbeddingVectorStore, 'findRemovedEvidence'>;

/** Recheck retained pages against the same root, local-row and tombstone fences as local search. */
export async function eligibleHybridChunks(
  chunks: readonly EvidenceChunk[],
  reader: EvidenceRemovalReader,
): Promise<EvidenceChunk[]> {
  const identities = new Map(
    chunks.map((chunk) => {
      const locator = chunk.metadata.evidenceLocator;
      return [
        chunk.id,
        [
          chunk.metadata.sourceId,
          ...chunk.metadata.sourceRecordIds,
          ...(locator.kind === 'structured_record' && locator.recordId === chunk.metadata.evidenceId
            ? [locator.recordId]
            : []),
        ],
      ] as const;
    }),
  );
  // External sample/transcript provenance is not a source_records row. Only
  // explicit roots and structured local row identities get missing-row checks.
  const roots = chunks
    .filter(
      (chunk) =>
        chunk.metadata.evidenceLocator.kind !== 'structured_record' &&
        chunk.metadata.sourceRecordIds.includes(chunk.metadata.sourceId),
    )
    .map((chunk) => chunk.metadata.sourceId);
  const localRecords = chunks.flatMap((chunk) => {
    const locator = chunk.metadata.evidenceLocator;
    return locator.kind === 'structured_record' && locator.recordId === chunk.metadata.evidenceId
      ? [locator.recordId]
      : [];
  });
  const removed = await reader.findRemovedEvidence(
    [...new Set([...identities.values()].flat())],
    chunks.map((chunk) => chunk.id),
    [...new Set(roots)],
    [...new Set(localRecords)],
  );
  const sourceIds = new Set(removed.sourceRecordIds);
  const chunkIds = new Set(removed.chunkIds);
  return chunks.filter(
    (chunk) =>
      !chunkIds.has(chunk.id) && !identities.get(chunk.id)!.some((id) => sourceIds.has(id)),
  );
}
