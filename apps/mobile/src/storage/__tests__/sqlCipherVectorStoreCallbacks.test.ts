import type { CallbackHandlerMethods } from '@langchain/core/callbacks/base';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';
import { VectorStoreRetriever } from '@langchain/core/vectorstores';
import type { SqlDatabase } from '@orot/storage';
import {
  chunk,
  document,
  installFingerprint,
  openDatabase,
  store,
} from '../testSupport/vectorStore';

declare const require: (specifier: string) => unknown;
const { AsyncLocalStorage } = require('node:async_hooks') as {
  AsyncLocalStorage: new () => {
    getStore(): unknown;
    run<T>(store: unknown, callback: () => T): T;
    enterWith(store: unknown): void;
  };
};
const { env } = require('node:process') as {
  env: Record<string, string | undefined>;
};

type TestStreamEvent = {
  event: string;
  data: { input?: unknown; output?: unknown };
};

describe('SQLCipher VectorStore callback privacy', () => {
  let database: SqlDatabase;
  let close = () => {};

  beforeEach(async () => {
    installFingerprint();
    const opened = await openDatabase();
    database = opened.database;
    close = opened.close;
  });

  afterEach(() => close());

  it('keeps callback payloads private and preserves caller-owned stream events', async () => {
    const original = chunk();
    const query = 'synthetic private query';
    const result = document(original);
    const seen: unknown[] = [];
    const handler: CallbackHandlerMethods = {
      handleRetrieverStart: (_retriever, input) => seen.push(input),
      handleRetrieverEnd: documents => seen.push(documents),
      handleRetrieverError: error => seen.push(error),
    };
    const providerKey = Symbol.for('ls:tracing_async_local_storage');
    const previousProvider = Object.getOwnPropertyDescriptor(
      globalThis,
      providerKey,
    );
    const tracingVariables = [
      'LANGCHAIN_TRACING',
      'LANGCHAIN_TRACING_V2',
      'LANGSMITH_TRACING',
    ] as const;
    const previousTracingValues = new Map(
      tracingVariables.map(name => [name, env[name]]),
    );
    const previousVerbose = env.LANGCHAIN_VERBOSE;
    const consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    tracingVariables.forEach(name => delete env[name]);
    env.LANGCHAIN_VERBOSE = 'false';
    AsyncLocalStorageProviderSingleton.initializeGlobalInstance(
      new AsyncLocalStorage(),
    );

    try {
      const { vectors } = store(database);
      await vectors.addVectors([[1, 0]], [result]);
      const filter = { candidates: [original] };
      const stockRetriever = new VectorStoreRetriever({
        vectorStore: vectors,
        k: 1,
        filter,
      });
      await AsyncLocalStorageProviderSingleton.runWithConfig(
        { callbacks: [handler] },
        () => stockRetriever.invoke(query),
      );
      expect(seen).toEqual([query, [result]]);

      seen.length = 0;
      const privateRetriever = vectors.asRetriever({
        k: 1,
        filter,
        callbacks: [handler],
      });
      await AsyncLocalStorageProviderSingleton.runWithConfig(
        { callbacks: [handler] },
        () => privateRetriever.invoke(query),
      );
      expect(seen).toEqual([]);

      env.LANGCHAIN_VERBOSE = 'true';
      await stockRetriever.invoke(query);
      const stockOutput = consoleLog.mock.calls.flat().join(' ');
      expect(stockOutput).toContain(query);
      expect(stockOutput).toContain(original.text);

      consoleLog.mockClear();
      await privateRetriever.invoke(query);
      expect(consoleLog).not.toHaveBeenCalled();
      env.LANGCHAIN_VERBOSE = 'false';
      consoleLog.mockClear();

      await privateRetriever.batch([query], [{ callbacks: [handler] }]);
      const stream = await privateRetriever.stream(query, {
        callbacks: [handler],
      });
      for await (const documents of stream) expect(documents).toEqual([result]);
      expect(seen).toEqual([]);

      const streamedEvents =
        await AsyncLocalStorageProviderSingleton.runWithConfig(
          { callbacks: [handler] },
          async () => {
            const collected: TestStreamEvent[] = [];
            const events = privateRetriever.streamEvents(query, {
              version: 'v2',
              callbacks: [handler],
            });
            for await (const event of events) collected.push(event);
            return collected;
          },
        );
      expect(streamedEvents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'on_retriever_start',
            data: { input: query },
          }),
          expect.objectContaining({
            event: 'on_retriever_end',
            data: { output: [result] },
          }),
        ]),
      );
      expect(seen).toEqual([]);

      const streamedEventsV1 =
        await AsyncLocalStorageProviderSingleton.runWithConfig(
          { callbacks: [handler] },
          async () => {
            const collected: TestStreamEvent[] = [];
            const events = privateRetriever.streamEvents(query, {
              version: 'v1',
              callbacks: [handler],
            });
            for await (const event of events) collected.push(event);
            return collected;
          },
        );
      expect(streamedEventsV1).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            event: 'on_retriever_start',
            data: { input: query },
          }),
          expect.objectContaining({
            event: 'on_retriever_end',
            data: { output: { documents: [result] } },
          }),
        ]),
      );
      expect(seen).toEqual([]);

      jest
        .spyOn(vectors, 'similaritySearchVectorWithScore')
        .mockRejectedValue(new Error('synthetic private failure'));
      await expect(privateRetriever.invoke(query)).rejects.toThrow(
        'synthetic private failure',
      );
      expect(seen).toEqual([]);
    } finally {
      jest.restoreAllMocks();
      tracingVariables.forEach(name => {
        const value = previousTracingValues.get(name);
        if (value === undefined) delete env[name];
        else env[name] = value;
      });
      if (previousVerbose === undefined) delete env.LANGCHAIN_VERBOSE;
      else env.LANGCHAIN_VERBOSE = previousVerbose;
      if (previousProvider)
        Object.defineProperty(globalThis, providerKey, previousProvider);
      else delete (globalThis as Record<PropertyKey, unknown>)[providerKey];
    }
  });
});
