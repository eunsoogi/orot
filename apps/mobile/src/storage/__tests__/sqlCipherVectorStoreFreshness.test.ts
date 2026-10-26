import type { SqlDatabase } from '@orot/storage';
import { SqlCipherRagEmbeddingStorage } from '../ragEmbeddingStorage';
import {
  chunk,
  document,
  installFingerprint,
  model,
  openDatabase,
  store,
} from '../testSupport/vectorStore';

describe('VectorStore candidate and revision boundaries', () => {
  let database: SqlDatabase;
  let close = () => {};
  beforeEach(async () => {
    installFingerprint();
    const opened = await openDatabase();
    database = opened.database;
    close = opened.close;
  });
  afterEach(() => close());

  it('rejects unbounded searches and never reads vectors outside the supplied candidate page', async () => {
    const { vectors } = store(database);
    const selected = chunk();
    const unrelated = chunk('unrelated', 'source-b');
    await vectors.addVectors(
      [
        [1, 0],
        [1, 0],
      ],
      [document(selected), document(unrelated)],
    );
    const reads = jest.spyOn(database, 'transaction');
    // Corrupt unrelated storage: a full-index deserialize would now fail this bounded search.
    await database.execute(
      'UPDATE rag_embeddings SET vector_blob = ? WHERE chunk_id = ?',
      [new Uint8Array([1]), unrelated.id],
    );
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [selected],
      }),
    ).toEqual([[document(selected), 1]]);
    reads.mockClear();
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [],
      }),
    ).toEqual([]);
    expect(reads).not.toHaveBeenCalled();
    await expect(
      vectors.similaritySearchVectorWithScore([1, 0], 1),
    ).rejects.toThrow('explicit candidate');
    await expect(
      vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: Array.from({ length: 501 }, (_, index) =>
          chunk(String(index)),
        ),
      }),
    ).rejects.toThrow('at most 500');
  });

  it('filters before ranking and sorts equal scores by stable chunk ID', async () => {
    const { vectors } = store(database);
    const a = chunk('a');
    const b = chunk('b', 'source-b');
    await vectors.addVectors(
      [
        [1, 0],
        [1, 0],
      ],
      [document(b), document(a)],
    );
    expect(
      (
        await vectors.similaritySearchVectorWithScore([1, 0], 2, {
          candidates: [b, a],
        })
      ).map(([value]) => value.id),
    ).toEqual(['a', 'b']);
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [a],
        recordTypes: ['medication_definition'],
      }),
    ).toEqual([]);
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [a],
        timeRange: { start: '2026-10-02T00:00:00Z' },
      }),
    ).toEqual([]);
  });

  it('does not associate changed text or transcript revisions with cached vectors', async () => {
    const { vectors } = store(database);
    const original = chunk();
    await vectors.addDocuments([document(original)]);
    const updated = { ...original, text: 'A corrected transcript' };
    const revised = {
      ...original,
      metadata: {
        ...original.metadata,
        transcriptRevision: {
          ...original.metadata.transcriptRevision!,
          revision: 2,
        },
      },
    };
    for (const candidate of [updated, revised]) {
      expect(
        await vectors.similaritySearchVectorWithScore([1, 0], 1, {
          candidates: [candidate],
        }),
      ).toEqual([]);
    }
    await vectors.addDocuments([document(revised)]);
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [revised],
      }),
    ).toEqual([[document(revised), 1]]);
    // Another existing writer can update the same model/blob; its missing revision write cannot validate stale text.
    await new SqlCipherRagEmbeddingStorage(database).upsertBatch(model, [
      { chunkId: original.id, sourceRecordIds: ['source-a'], vector: [0, 1] },
    ]);
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [revised],
      }),
    ).toEqual([]);
  });

  it('rolls back vectors if persisting the matching revision fails', async () => {
    const { vectors } = store(database);
    const original = chunk();
    await vectors.addDocuments([document(original)]);
    await database.execute(`CREATE TRIGGER reject_revision BEFORE UPDATE ON rag_vector_document_revisions
      BEGIN SELECT RAISE(ABORT, 'synthetic revision failure'); END`);
    await expect(
      vectors.addVectors(
        [[0, 1]],
        [document({ ...original, text: 'replacement' })],
      ),
    ).rejects.toThrow('synthetic revision failure');
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [original],
      }),
    ).toEqual([[document(original), 1]]);
  });

  it('snapshots documents before embedding can yield to caller mutation', async () => {
    const { vectors, embeddings } = store(database);
    const original = chunk();
    const input = document(original);
    embeddings.embedDocuments.mockImplementationOnce(async () => {
      input.pageContent = 'Caller changed this during inference';
      return [[1, 0]];
    });
    await vectors.addDocuments([input]);
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [original],
      }),
    ).toEqual([[document(original), 1]]);
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [{ ...original, text: input.pageContent }],
      }),
    ).toEqual([]);
  });
});
