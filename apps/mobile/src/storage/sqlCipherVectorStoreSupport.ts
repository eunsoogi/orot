import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import {
  CallbackManager,
  type Callbacks,
} from '@langchain/core/callbacks/manager';
import type { DocumentInterface } from '@langchain/core/documents';
import { ensureConfig, type RunnableConfig } from '@langchain/core/runnables';
import { VectorStoreRetriever } from '@langchain/core/vectorstores';
import type { SqlCipherVectorStore } from './sqlCipherVectorStore';

/**
 * Run retrieval without ambient content callbacks. Only LangChain's internal
 * event/log stream handler may observe content returned to its direct caller.
 */
export class PrivateVectorStoreRetriever extends VectorStoreRetriever<SqlCipherVectorStore> {
  override invoke(
    query: string,
    options?: Partial<RunnableConfig>,
  ): Promise<DocumentInterface[]> {
    return this.retrieveForCaller(query, options);
  }

  private async retrieveForCaller(
    query: string,
    options?: Partial<RunnableConfig>,
  ): Promise<DocumentInterface[]> {
    const config = ensureConfig(options);
    const eventHandlers = (callbacks?: Callbacks) => {
      const handlers = Array.isArray(callbacks)
        ? callbacks
        : (callbacks?.handlers ?? []);
      return handlers.filter((handler): handler is BaseCallbackHandler => {
        const candidate = handler as {
          name?: unknown;
          receiveStream?: unknown;
          tapOutputIterable?: unknown;
        };
        return (
          handler instanceof BaseCallbackHandler &&
          (candidate.name === 'event_stream_tracer' ||
            candidate.name === 'log_stream_tracer') &&
          candidate.receiveStream !== undefined &&
          typeof candidate.tapOutputIterable === 'function'
        );
      });
    };
    const handlers = [
      ...eventHandlers(config.callbacks),
      ...eventHandlers(this.callbacks),
    ];
    if (handlers.length === 0) return this._getRelevantDocuments(query);

    // configure() installs ambient console, LangSmith, and extension hooks.
    // Build a local manager containing only the event stream consumed by caller.
    const callbackManager = new CallbackManager();
    handlers.forEach(handler => callbackManager.addHandler(handler));
    callbackManager.addTags(this.tags ?? []);
    callbackManager.addTags(config.tags ?? [], false);
    callbackManager.addMetadata(this.metadata ?? {});
    callbackManager.addMetadata(config.metadata ?? {}, false);
    const runManager = await callbackManager.handleRetrieverStart(
      this.toJSON(),
      query,
      config.runId,
      undefined,
      undefined,
      undefined,
      config.runName ?? this.getName(),
    );
    try {
      const documents = await this._getRelevantDocuments(query, runManager);
      await runManager.handleRetrieverEnd(documents);
      return documents;
    } catch (error) {
      await runManager.handleRetrieverError(error);
      throw error;
    }
  }
}

/** Cosine scores retain existing vector ranking; zero vectors are not searchable. */
export function vectorSimilarity(
  left: readonly number[],
  right: readonly number[],
): number {
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    a += left[index] ** 2;
    b += right[index] ** 2;
  }
  return a && b ? dot / Math.sqrt(a * b) : Number.NEGATIVE_INFINITY;
}
