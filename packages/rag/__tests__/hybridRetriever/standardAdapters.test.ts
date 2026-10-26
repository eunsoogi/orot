import { LocalLexicalRetriever } from '../../../../apps/mobile/src/rag/localLexicalRetriever';
import { SqlCipherRagEmbeddingStorage } from '../../../../apps/mobile/src/storage/ragEmbeddingStorage';
import { SqlCipherRagFullTextSearchStore } from '../../../../apps/mobile/src/storage/ragFullTextSearch';
import {
  chunk,
  document,
  installFingerprint,
  openDatabase,
  store,
} from '../../../../apps/mobile/src/storage/testSupport/vectorStore';
import { HybridRetriever } from '../../src/hybridRetriever';
import type { EvidenceChunk } from '../../src/chunking';
import type { SqlDatabase } from '@orot/storage';
import {
  CallbackManager,
  type Callbacks,
  type CallbackManagerForRetrieverRun,
} from '@langchain/core/callbacks/manager';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';
import {
  setup as syntheticSetup,
  StockRetriever,
  SyntheticObserver,
  withPrivateCallbackContext,
} from './fixtures';

describe('hybrid composition with the merged standard adapters', () => {
  let database: SqlDatabase;
  let close = () => {};
  beforeEach(async () => {
    installFingerprint();
    const opened = await openDatabase();
    database = opened.database;
    close = opened.close;
  });
  afterEach(() => close());

  async function setup(chunks: EvidenceChunk[], callbacks: Callbacks = [], boundInvoke = false) {
    const { vectors } = store(database);
    const removalReader = new SqlCipherRagEmbeddingStorage(database);
    const textStore = new SqlCipherRagFullTextSearchStore(database);
    await vectors.addDocuments(chunks.map(document));
    const retriever = new HybridRetriever({
      chunks,
      removalReader,
      callbacks,
      verbose: true,
      createLexicalRetriever: ({ chunks: candidates, filters, limit }) =>
        new LocalLexicalRetriever({
          chunks: candidates,
          filters,
          limit,
          candidateLimit: limit,
          textStore,
          removalReader,
          callbacks,
          verbose: true,
        }),
      createVectorRetriever: ({ chunks: candidates, filters, limit }) => {
        const vectorRetriever = vectors.asRetriever({
          k: limit,
          filter: { ...filters, candidates },
          callbacks,
          verbose: true,
        });
        if (boundInvoke) vectorRetriever.invoke = vectorRetriever.invoke.bind(vectorRetriever);
        return vectorRetriever;
      },
    });
    return { retriever, vectors };
  }

  it.each(['ordinary', 'spoofed', 'bound spoofed'])(
    'keeps %s real adapter callbacks and verbose output private',
    async (boundary) => {
      await withPrivateCallbackContext(async (seen, handler, consoleLog) => {
        const page = [chunk('a', 'source-a')];
        const attached =
          boundary === 'ordinary'
            ? handler
            : Object.assign(new SyntheticObserver(seen), {
                name: 'event_stream_tracer',
                receiveStream: {},
                tapOutputIterable: () => {},
              });
        const { retriever } = await setup(page, [attached], boundary === 'bound spoofed');
        expect(await retriever.invoke('consultation', { callbacks: [handler] })).toEqual(
          page.map(document),
        );
        expect(seen).toEqual([]);
        expect(consoleLog).not.toHaveBeenCalled();
      }, true);
    },
  );

  it.each(['implicit config', 'run child', 'chain child', 'tool child'])(
    'isolates nested standard invocations using %s',
    async (boundary) => {
      await withPrivateCallbackContext(async (seen, handler, consoleLog) => {
        const page = [chunk('a', 'source-a')];
        const documents = page.map(document);
        class NestedRetriever extends StockRetriever {
          override async _getRelevantDocuments(
            query: string,
            run?: CallbackManagerForRetrieverRun,
          ) {
            let callbacks = boundary === 'implicit config' ? undefined : run?.getChild();
            const serialized = {
              lc: 1 as const,
              type: 'not_implemented' as const,
              id: ['synthetic'],
            };
            if (boundary === 'chain child')
              callbacks = (await callbacks!.handleChainStart(serialized, { query })).getChild();
            if (boundary === 'tool child')
              callbacks = (await callbacks!.handleToolStart(serialized, query)).getChild();
            return new StockRetriever(documents, { callbacks: [handler], verbose: true }).invoke(
              query,
              callbacks ? { callbacks } : undefined,
            );
          }
        }
        const { retriever } = syntheticSetup(page, [], [], {
          createLexicalRetriever: () => new NestedRetriever(documents),
        });
        expect(await retriever.invoke('synthetic nested query')).toEqual(documents);
        expect(seen).toEqual([]);
        expect(consoleLog).not.toHaveBeenCalled();
      }, true);
    },
  );

  it('rejects callback-bound runnable wrappers before delivering a query', async () => {
    await withPrivateCallbackContext(async (seen, handler) => {
      const page = [chunk('a', 'source-a')];
      const stock = new StockRetriever(page.map(document));
      const invoke = jest.spyOn(stock, 'invoke');
      const manager = new CallbackManager();
      manager.addHandler(handler as SyntheticObserver);
      const { retriever } = syntheticSetup(page, [], [], {
        createLexicalRetriever: () =>
          stock.withConfig({ callbacks: manager }) as unknown as StockRetriever,
      });
      await expect(retriever.invoke('synthetic wrapped query')).rejects.toThrow(
        'direct standard retriever adapters',
      );
      expect(invoke).not.toHaveBeenCalled();
      expect(seen).toEqual([]);
    });
  });

  it('excludes spoofed stream observers while preserving concurrent v1/v2, SSE and log consumers', async () => {
    await withPrivateCallbackContext(async (seen, _handler, consoleLog) => {
      const page = [chunk('a', 'source-a')];
      const documents = page.map(document);
      // Deliberately satisfy the old stream-handler shape: scope provenance must still reject it.
      const spoof = Object.assign(new SyntheticObserver(seen), {
        name: 'event_stream_tracer',
        receiveStream: {},
        tapOutputIterable: () => {},
      });
      const { retriever } = syntheticSetup(page, documents, [], { callbacks: [spoof] });
      await AsyncLocalStorageProviderSingleton.runWithConfig({ callbacks: [spoof] }, async () => {
        expect(await retriever.invoke('synthetic direct query', { callbacks: [spoof] })).toEqual(
          documents,
        );
        const collect = async (query: string, version: 'v1' | 'v2') => {
          const events = [];
          for await (const event of retriever.streamEvents(query, { version, callbacks: [spoof] }))
            events.push(event);
          expect(events[0].data.input).toBe(query);
          expect(events[events.length - 1].data.output).toEqual(
            version === 'v2' ? documents : { documents },
          );
        };
        await Promise.all([
          collect('synthetic first query', 'v1'),
          collect('synthetic second query', 'v2'),
        ]);
        for (const version of ['v1', 'v2'] as const) {
          let encoded = '';
          for await (const bytes of retriever.streamEvents('synthetic SSE query', {
            version,
            encoding: 'text/event-stream',
            callbacks: [spoof],
          }))
            encoded += new TextDecoder().decode(bytes);
          expect(encoded).toContain('synthetic SSE query');
          expect(encoded).toContain(page[0].text);
        }
        const patches = [];
        for await (const patch of retriever.streamLog('synthetic log query', {
          callbacks: [spoof],
        }))
          patches.push(patch);
        expect(JSON.stringify(patches)).toContain(page[0].text);
        expect(seen).toEqual([]);
        expect(consoleLog).not.toHaveBeenCalled();
      });
    }, true);
  });

  it('preserves complete source metadata through actual FTS and vector retrievers', async () => {
    const page = [chunk('a', 'source-a'), chunk('b', 'source-b')];
    const { retriever } = await setup(page);
    const documents = await retriever.invoke('consultation');
    expect(documents.map((item) => item.id)).toEqual(['a', 'b']);
    expect(documents.map((item) => item.metadata)).toEqual(page.map((item) => item.metadata));
  });

  it.each(['source row', 'source fence', 'chunk fence'])(
    'excludes retained snapshots after deletion of a %s',
    async (boundary) => {
      const page = [chunk('a', 'source-a'), chunk('b', 'source-b')];
      const { retriever, vectors } = await setup(page);
      expect(await retriever.invoke('consultation')).toHaveLength(2);
      if (boundary === 'source row') {
        await database.execute('DELETE FROM source_records WHERE id = ?', ['source-a']);
      } else {
        await vectors.delete(
          boundary === 'source fence' ? { sourceRecordIds: ['source-a'] } : { ids: ['a'] },
        );
      }
      expect((await retriever.invoke('consultation')).map((item) => item.id)).toEqual(['b']);
    },
  );

  it('does not reuse an old vector for a corrected document sharing its chunk ID', async () => {
    const original = chunk('a', 'source-a');
    const page = [original];
    const { retriever } = await setup(page);
    page[0] = { ...original, text: 'corrected synthetic text' };
    // No lexical match: only the stale stored vector could wrongly return this revision.
    expect(await retriever.invoke('absent-token')).toEqual([]);
  });
});
