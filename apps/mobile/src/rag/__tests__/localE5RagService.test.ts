import { LOCAL_EMBEDDING_IDENTITY } from '@orot/rag';
import type { SqlDatabase, SqlTransaction } from '@orot/storage';
import { localE5NativeBackend } from '../localE5NativeBackend';
import { createLocalE5RagService } from '../localE5RagService';
import { LocalE5Embeddings } from '../localE5Embeddings';
import { LocalLexicalRetriever } from '../localLexicalRetriever';
import { SqlCipherVectorStore } from '../../storage/sqlCipherVectorStore';
import { SqlCipherRagEmbeddingStorage } from '../../storage/ragEmbeddingStorage';
import {
  chunk,
  installFingerprint,
  openDatabase,
} from '../../storage/testSupport/vectorStore';

jest.mock('../localE5NativeBackend', () => ({
  localE5NativeBackend: {
    prepare: jest.fn(),
    embedBatch: jest.fn(),
    cancel: jest.fn(),
  },
}));
jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

describe('production RAG standard adapters', () => {
  let database: SqlDatabase;
  let close = () => {};
  const page = [
    chunk('a', 'source-a'),
    chunk('b', 'source-b'),
    chunk('c', 'source-c'),
  ];
  beforeEach(async () => {
    jest.clearAllMocks();
    installFingerprint();
    const opened = await openDatabase();
    database = opened.database;
    close = opened.close;
    jest
      .mocked(localE5NativeBackend.prepare)
      .mockImplementation(async (_id, progress) => progress(1, 1));
    jest
      .mocked(localE5NativeBackend.embedBatch)
      .mockImplementation(async texts =>
        texts.map(() =>
          Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0)),
        ),
      );
  });
  afterEach(() => {
    jest.restoreAllMocks();
    close();
  });

  it('preserves the weighted ranking contract while executing real standard adapters once', async () => {
    const rag = createLocalE5RagService(database);
    await rag.index(page);
    const options = {
      ranking: {
        lexicalWeight: 2,
        vectorWeight: 1,
        rrfConstant: 0,
        candidateLimit: 2,
      },
    };

    const embedding = jest.spyOn(LocalE5Embeddings.prototype, 'embedQuery');
    const vector = jest.spyOn(
      SqlCipherVectorStore.prototype,
      'similaritySearchVectorWithScore',
    );
    const lexical = jest.spyOn(
      LocalLexicalRetriever.prototype,
      '_getRelevantDocuments',
    );
    const actual = await rag.search('consultation', page, 2, options);
    expect(actual).toEqual([
      { chunk: page[0], lexicalRank: 1, vectorRank: 1, score: 3 },
      { chunk: page[1], lexicalRank: 2, vectorRank: 2, score: 1.5 },
    ]);
    expect(embedding).toHaveBeenCalledTimes(1);
    expect(vector).toHaveBeenCalledTimes(1);
    expect(lexical).toHaveBeenCalledTimes(1);
    expect(
      await rag.search('consultation', page, 2, {
        filters: { recordTypes: ['encounter'] },
      }),
    ).toEqual([]);
    expect(await rag.search(' ', page)).toEqual([]);
    await expect(rag.search('consultation', page, 0)).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('rejects invalid index batches and duplicate IDs before native inference', async () => {
    const rag = createLocalE5RagService(database);
    await expect(rag.index(page, { batchSize: 9 })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(rag.index([page[0], page[0]])).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(localE5NativeBackend.embedBatch).not.toHaveBeenCalled();
  });

  it('indexes through embeddings and vector persistence with aggregate progress', async () => {
    const embedding = jest.spyOn(LocalE5Embeddings.prototype, 'embedDocuments');
    const persist = jest.spyOn(SqlCipherVectorStore.prototype, 'addVectors');
    const progress = jest.fn();
    await createLocalE5RagService(database).index(page, {
      batchSize: 2,
      onProgress: progress,
    });
    expect(embedding).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledTimes(2);
    expect(progress.mock.calls.map(([value]) => value)).toEqual([
      { stage: 'model_download', completed: 1, total: 1 },
      { stage: 'embedding', completed: 2, total: 3 },
      { stage: 'persisting', completed: 2, total: 3 },
      { stage: 'model_download', completed: 1, total: 1 },
      { stage: 'embedding', completed: 3, total: 3 },
      { stage: 'persisting', completed: 3, total: 3 },
    ]);
  });

  it('does not reuse a previous vector for a corrected chunk, and reindexes its current revision', async () => {
    const rag = createLocalE5RagService(database);
    await rag.index([page[0]]);
    const corrected = {
      ...page[0],
      text: 'corrected synthetic evidence',
      metadata: {
        ...page[0].metadata,
        transcriptRevision: {
          ...page[0].metadata.transcriptRevision!,
          revision: 2,
        },
      },
    };
    expect(await rag.search('no-lexical-match', [corrected])).toEqual([]);
    await rag.index([corrected]);
    expect(
      (await rag.search('no-lexical-match', [corrected]))[0],
    ).toMatchObject({ chunk: corrected, lexicalRank: null, vectorRank: 1 });
    expect(await rag.search('no-lexical-match', [page[0]])).toEqual([]);
    expect(
      (
        await createLocalE5RagService(database).search('no-lexical-match', [
          corrected,
        ])
      )[0].chunk,
    ).toEqual(corrected);
  });

  it.each(['source row', 'chunk fence', 'clear'])(
    'excludes retained chunks after %s deletion and prevents delayed reindexing',
    async boundary => {
      const rag = createLocalE5RagService(database);
      await rag.index(page);
      await rag.prepare();
      if (boundary === 'source row')
        await database.execute('DELETE FROM source_records WHERE id = ?', [
          'source-a',
        ]);
      else
        await database.transaction(transaction =>
          boundary === 'clear'
            ? rag.clear(['source-a'], transaction)
            : rag.deleteChunks([page[0]], ['source-a'], transaction),
        );
      const hits = await createLocalE5RagService(database).search(
        'consultation',
        page,
      );
      expect(hits.map(hit => hit.chunk.id)).toEqual(
        boundary === 'clear' ? [] : ['b', 'c'],
      );
      await expect(rag.index([page[0]])).rejects.toThrow('Removed evidence');
    },
  );

  it('keeps cancelled search controls separate from a concurrent successful query', async () => {
    const rag = createLocalE5RagService(database);
    await rag.index(page);
    const cancelled = new AbortController();
    cancelled.abort();
    const onProgress = jest.fn();
    const results = await Promise.allSettled([
      rag.search('consultation', page, 1, { signal: cancelled.signal }),
      rag.search('consultation', page, 1, { onProgress }),
    ]);
    expect(results[0]).toMatchObject({
      status: 'rejected',
      reason: { name: 'AbortError' },
    });
    expect(results[1]).toMatchObject({
      status: 'fulfilled',
      value: [{ chunk: page[0] }],
    });
    expect(onProgress).toHaveBeenLastCalledWith({
      stage: 'embedding',
      role: 'query',
      completed: 1,
      total: 1,
    });
  });

  it('rolls back a cancelled persistence batch while keeping an earlier completed batch', async () => {
    const controller = new AbortController();
    let inserts = 0;
    const interrupted: SqlDatabase = {
      execute: (sql, values) => database.execute(sql, values),
      transaction: operation =>
        database.transaction(transaction =>
          operation({
            ...transaction,
            async execute(sql, values) {
              const result = await transaction.execute(sql, values);
              if (
                sql.startsWith('INSERT INTO rag_embeddings') &&
                ++inserts === 2
              )
                controller.abort();
              return result;
            },
          } as SqlTransaction),
        ),
    };
    await expect(
      createLocalE5RagService(interrupted).index(page, {
        batchSize: 1,
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    const rows = await new SqlCipherRagEmbeddingStorage(database).listForModel(
      LOCAL_EMBEDDING_IDENTITY,
    );
    expect(rows.map(row => row.chunkId)).toEqual(['a']);
    const revisions = await database.execute(
      'SELECT chunk_id FROM rag_vector_document_revisions',
    );
    expect(revisions.rows).toEqual([{ chunk_id: 'a' }]);
  });
});
