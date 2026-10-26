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

  async function setup(chunks: EvidenceChunk[]) {
    const { vectors } = store(database);
    const removalReader = new SqlCipherRagEmbeddingStorage(database);
    const textStore = new SqlCipherRagFullTextSearchStore(database);
    await vectors.addDocuments(chunks.map(document));
    const retriever = new HybridRetriever({
      chunks,
      removalReader,
      createLexicalRetriever: ({ chunks: candidates, filters, limit }) =>
        new LocalLexicalRetriever({
          chunks: candidates,
          filters,
          limit,
          candidateLimit: limit,
          textStore,
          removalReader,
        }),
      createVectorRetriever: ({ chunks: candidates, filters, limit }) =>
        vectors.asRetriever({
          k: limit,
          filter: { ...filters, candidates },
        }),
    });
    return { retriever, vectors };
  }

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
