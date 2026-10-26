// Hermes must use LangGraph's web export, whose entry avoids Node AsyncLocalStorage initialization.
import { BaseStore } from '@langchain/langgraph/web';
import type { Operation, OperationResults } from '@langchain/langgraph/web';
import { RememoriLangGraphBackend } from './backend';
import type { RememoriLangGraphStoreOptions } from './types';

/** LangGraph's key/value contract backed by the app's existing Rememori storage. */
export class RememoriLangGraphStore extends BaseStore {
  private readonly backend: RememoriLangGraphBackend;

  constructor(options: RememoriLangGraphStoreOptions) {
    super();
    this.backend = new RememoriLangGraphBackend(options);
  }

  batch<Op extends Operation[]>(operations: Op): Promise<OperationResults<Op>> {
    return this.backend.batch(operations);
  }

  start(): Promise<void> {
    return this.backend.start();
  }

  stop(): Promise<void> {
    return this.backend.stop();
  }
}
