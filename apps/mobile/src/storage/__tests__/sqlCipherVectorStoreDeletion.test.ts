import type { SqlDatabase } from '@orot/storage';
import { createRecordRepository } from '@orot/storage';
import { chunkStructuredRecord } from '@orot/rag';
import { healthObservation } from '../../../../../packages/storage/__tests__/localQueryTestSupport';
import { SqlCipherRagEmbeddingStorage } from '../ragEmbeddingStorage';
import {
  chunk,
  document,
  installFingerprint,
  openDatabase,
  store,
} from '../testSupport/vectorStore';

describe('VectorStore source deletion and tombstones', () => {
  let database: SqlDatabase;
  let close = () => {};
  beforeEach(async () => {
    installFingerprint();
    const opened = await openDatabase();
    database = opened.database;
    close = opened.close;
  });
  afterEach(() => close());

  it('indexes a transcript whose source has the same ID as a deleted symptom', async () => {
    await database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      ['source-a'],
    );
    const original = chunk();
    const { vectors } = store(database);
    await expect(vectors.addDocuments([document(original)])).resolves.toEqual([
      original.id,
    ]);
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [original],
      }),
    ).toHaveLength(1);
  });

  it('indexes a HealthKit sample whose external ID matches a deleted symptom', async () => {
    const observation = {
      ...healthObservation('observation', 'heart_rate', '2026-10-01T12:00:00Z'),
      provenance: {
        origin: 'imported' as const,
        sourceRecordIds: ['sample'],
        source: { system: 'healthkit', sourceIdentifier: 'synthetic' },
      },
    };
    await createRecordRepository(database).put(
      'health_observation',
      observation,
    );
    await database.execute(
      'INSERT INTO legacy_symptom_deleted (id) VALUES (?)',
      ['sample'],
    );
    const evidence = chunkStructuredRecord('health_observation', observation);
    const { vectors } = store(database);
    await expect(vectors.addDocuments([document(evidence)])).resolves.toEqual([
      evidence.id,
    ]);
  });

  it('fences a deleted chunk across models and rejects delayed writes after recreation', async () => {
    const original = chunk();
    const { vectors } = store(database);
    await vectors.addDocuments([document(original)]);
    await vectors.delete({ ids: [original.id] });
    const reopened = store(database).vectors;
    expect(
      await reopened.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [original],
      }),
    ).toEqual([]);
    await expect(reopened.addDocuments([document(original)])).rejects.toThrow(
      'Removed evidence',
    );
    expect(
      (await database.execute('SELECT count(*) AS count FROM rag_embeddings'))
        .rows[0].count,
    ).toBe(0);
  });

  it('honors deletion by the existing storage path and blocks a rebuilt chunk for that source', async () => {
    const { vectors } = store(database);
    const original = chunk();
    await vectors.addDocuments([document(original)]);
    await new SqlCipherRagEmbeddingStorage(database).deleteEvidence(
      ['source-a'],
      [],
    );
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [original],
      }),
    ).toEqual([]);
    await expect(
      vectors.addDocuments([document(chunk('rebuilt'))]),
    ).rejects.toThrow('Removed evidence');
    // The side table retains only a digest, never the deleted source text or citation metadata.
    const rows = await database.execute(
      'SELECT * FROM rag_vector_document_revisions',
    );
    expect(JSON.stringify(rows.rows)).not.toContain(original.text);
  });

  it('rejects a source deletion that arrives while embeddings are running', async () => {
    const { vectors, embeddings } = store(database);
    embeddings.embedDocuments.mockImplementationOnce(async () => {
      await vectors.delete({ sourceRecordIds: ['source-a'] });
      return [[1, 0]];
    });
    await expect(vectors.addDocuments([document(chunk())])).rejects.toThrow(
      'Removed evidence',
    );
    expect(
      (await database.execute('SELECT count(*) AS count FROM rag_embeddings'))
        .rows[0].count,
    ).toBe(0);
  });

  it('excludes missing source roots and structured rows even without vector tombstones', async () => {
    const { vectors } = store(database);
    const original = chunk();
    await vectors.addDocuments([document(original)]);
    await database.execute('DELETE FROM source_records WHERE id = ?', [
      'source-a',
    ]);
    expect(
      await vectors.similaritySearchVectorWithScore([1, 0], 1, {
        candidates: [original],
      }),
    ).toEqual([]);
    await expect(vectors.addDocuments([document(original)])).rejects.toThrow(
      'Removed evidence',
    );
    const structured = chunk('sample', 'healthkit-external-sample');
    const evidence = {
      ...structured,
      metadata: {
        ...structured.metadata,
        evidenceId: 'healthkit-row',
        recordType: 'health_observation' as const,
        evidenceLocator: {
          kind: 'structured_record' as const,
          recordId: 'healthkit-row',
        },
      },
    };
    await expect(vectors.addDocuments([document(evidence)])).rejects.toThrow(
      'Removed evidence',
    );
  });

  it('preserves full-clear fences and requires explicit delete scope', async () => {
    const { vectors } = store(database);
    await vectors.addDocuments([document(chunk())]);
    await new SqlCipherRagEmbeddingStorage(database).clear();
    await expect(
      vectors.addDocuments([document(chunk('rebuilt'))]),
    ).rejects.toThrow('Removed evidence');
    await expect(vectors.delete()).rejects.toThrow(
      'explicit evidence identities',
    );
  });
});
