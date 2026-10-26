import type { DocumentInterface } from '@langchain/core/documents';
import type { EvidenceChunk } from '../../src/chunking';
import { evidenceChunkToDocument } from '../../src/langchain/documents';
import { HybridRetriever, type HybridRetrieverInput } from '../../src/hybridRetriever';
import { BaseRetriever, type BaseRetrieverInput } from '@langchain/core/retrievers';
import { BaseCallbackHandler, type CallbackHandlerMethods } from '@langchain/core/callbacks/base';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';
import { registerConfigureHook, setContextVariable } from '@langchain/core/context';

declare const require: (specifier: string) => unknown;

/** Await callbacks so a privacy assertion cannot pass before a queued disclosure runs. */
export class SyntheticObserver extends BaseCallbackHandler {
  name = 'synthetic_observer';
  constructor(private readonly seen: unknown[]) {
    super({ _awaitHandler: true });
  }
  handleRetrieverStart(_retriever: unknown, query: string) {
    this.seen.push(query);
  }
  handleRetrieverEnd(documents: DocumentInterface[]) {
    this.seen.push(documents);
  }
  handleRetrieverError(error: Error) {
    this.seen.push(error);
  }
}

/** Stock behavior is a positive control for detecting query, result and error disclosure. */
export class StockRetriever extends BaseRetriever {
  lc_namespace = ['synthetic', 'retriever'];
  constructor(
    readonly documents: DocumentInterface[],
    input: BaseRetrieverInput = {},
    readonly failure?: Error,
  ) {
    super(input);
  }
  async _getRelevantDocuments(_query: string) {
    if (this.failure) throw this.failure;
    return this.documents;
  }
}

/** Isolate synthetic ambient callbacks without enabling real network tracing. */
export async function withPrivateCallbackContext(
  test: (
    seen: unknown[],
    handler: CallbackHandlerMethods,
    consoleLog: jest.SpyInstance,
  ) => Promise<void>,
  verbose = false,
) {
  const { AsyncLocalStorage } = require('node:async_hooks') as {
    AsyncLocalStorage: new () => {
      getStore(): unknown;
      run<T>(store: unknown, callback: () => T): T;
      enterWith(store: unknown): void;
    };
  };
  const { env } = require('node:process') as { env: Record<string, string | undefined> };
  const key = Symbol.for('ls:tracing_async_local_storage');
  const previousProvider = Object.getOwnPropertyDescriptor(globalThis, key);
  const names = [
    'LANGCHAIN_TRACING',
    'LANGCHAIN_TRACING_V2',
    'LANGSMITH_TRACING',
    'LANGCHAIN_VERBOSE',
  ];
  const values = names.map((name) => env[name]);
  names.forEach((name) => delete env[name]);
  env.LANGCHAIN_VERBOSE = String(verbose);
  AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
  const seen: unknown[] = [];
  const handler = new SyntheticObserver(seen);
  // A configure hook can reinstall observers even after callbacks:[]; test that path too.
  registerConfigureHook({ contextVar: 'synthetic_callback_observer' });
  setContextVariable('synthetic_callback_observer', handler);
  const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await AsyncLocalStorageProviderSingleton.runWithConfig({ callbacks: [handler] }, () =>
      test(seen, handler, consoleLog),
    );
  } finally {
    consoleLog.mockRestore();
    names.forEach((name, index) => {
      if (values[index] === undefined) delete env[name];
      else env[name] = values[index];
    });
    if (previousProvider) Object.defineProperty(globalThis, key, previousProvider);
    else delete (globalThis as Record<PropertyKey, unknown>)[key];
  }
}

/** Synthetic citation identities keep rank and freshness tests independent of personal records. */
export function chunk(id: string): EvidenceChunk {
  return {
    id,
    text: 'Synthetic consultation ' + id,
    metadata: {
      sourceId: 'source-' + id,
      sourceRecordIds: ['source-' + id],
      evidenceId: 'record-' + id,
      evidenceLocator: { kind: 'text_range', startOffset: 0, endOffset: 12 },
      effectiveTime: '2026-10-01T10:00:00Z',
      recordType: 'transcript_segment',
      reviewState: { status: 'unreviewed' },
      encounterId: 'encounter-a',
    },
  };
}

export const document = evidenceChunkToDocument;

export function setup(
  chunks: EvidenceChunk[],
  lexical: DocumentInterface[],
  vector: DocumentInterface[],
  overrides: Partial<HybridRetrieverInput> = {},
) {
  const lexicalInvoke = jest.fn(async () => lexical);
  const vectorInvoke = jest.fn(async () => vector);
  const removalReader = {
    findRemovedEvidence: jest.fn(async () => ({
      sourceRecordIds: [] as string[],
      chunkIds: [] as string[],
    })),
  };
  const input = {
    chunks,
    removalReader,
    createLexicalRetriever: jest.fn(() =>
      Object.assign(new StockRetriever([]), { invoke: lexicalInvoke }),
    ),
    createVectorRetriever: jest.fn(() =>
      Object.assign(new StockRetriever([]), { invoke: vectorInvoke }),
    ),
    ...overrides,
  };
  return {
    retriever: new HybridRetriever(input),
    input,
    lexicalInvoke,
    vectorInvoke,
    removalReader,
  };
}
