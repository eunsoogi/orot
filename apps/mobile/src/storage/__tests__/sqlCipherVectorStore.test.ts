import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  chunk,
  document,
  installFingerprint,
  model,
  openDatabase,
  store,
} from '../testSupport/vectorStore';

declare const require: (specifier: string) => unknown;
const { mkdtempSync, rmSync } = require('node:fs') as {
  mkdtempSync(prefix: string): string;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
};
const { tmpdir } = require('node:os') as { tmpdir(): string };

describe('SQLCipher LangChain VectorStore', () => {
  let database: SqlDatabase;
  let close = () => {};
  beforeEach(async () => {
    installFingerprint();
    const opened = await openDatabase();
    database = opened.database;
    close = opened.close;
  });
  afterEach(() => close());

  it('upserts stable IDs and exposes standard similarity and retriever APIs', async () => {
    const { vectors, embeddings } = store(database);
    const original = chunk();
    expect(await vectors.addDocuments([document(original)])).toEqual([
      original.id,
    ]);
    expect(embeddings.embedDocuments).toHaveBeenCalledWith([original.text]);
    expect(
      await vectors.similaritySearch('question', 1, { candidates: [original] }),
    ).toEqual([document(original)]);
    expect(
      await vectors
        .asRetriever({ k: 1, filter: { candidates: [original] } })
        .invoke('question'),
    ).toEqual([document(original)]);
    const corrected = { ...original, text: 'Corrected synthetic text' };
    await vectors.addVectors([[0, 1]], [document(corrected)]);
    expect(
      await vectors.similaritySearchVectorWithScore([0, 1], 1, {
        candidates: [corrected],
      }),
    ).toEqual([[document(corrected), 1]]);
    expect(
      (await database.execute('SELECT count(*) AS count FROM rag_embeddings'))
        .rows[0].count,
    ).toBe(1);
  });

  it('persists vectors and revision identity across a real close and reopen', async () => {
    // Plain SQLite establishes durable SQL semantics; native SQLCipher remains a separate proof surface.
    const folder = mkdtempSync(tmpdir() + '/orot-vector-store-');
    let connection = await openDatabase(folder + '/vectors.db');
    try {
      const original = chunk();
      await store(connection.database).vectors.addDocuments([
        document(original),
      ]);
      connection.close();
      connection = openSqliteTestDatabase(folder + '/vectors.db');
      const reopened = store(connection.database).vectors;
      expect(
        await reopened.similaritySearchVectorWithScore([1, 0], 1, {
          candidates: [original],
        }),
      ).toEqual([[document(original), 1]]);
      const rows = await connection.database.execute(
        'SELECT fingerprint FROM rag_vector_document_revisions',
      );
      expect(rows.rows[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      connection.close();
      rmSync(folder, { recursive: true, force: true });
    }
  });

  it('isolates model revisions, model IDs, dimensions and artifact hashes', async () => {
    const original = chunk();
    await store(database).vectors.addDocuments([document(original)]);
    for (const identity of [
      { ...model, id: 'other' },
      { ...model, revision: 'revision-2' },
    ]) {
      expect(
        await store(database, identity).vectors.similaritySearchVectorWithScore(
          [1, 0],
          1,
          { candidates: [original] },
        ),
      ).toEqual([]);
    }
    for (const identity of [
      { ...model, dimension: 3 },
      { ...model, modelSha256: 'c'.repeat(64) },
      { ...model, tokenizerSha256: 'd'.repeat(64) },
    ]) {
      await expect(
        store(database, identity).vectors.similaritySearchVectorWithScore(
          Array.from({ length: identity.dimension }, (_, index) =>
            index === 0 ? 1 : 0,
          ),
          1,
          { candidates: [original] },
        ),
      ).rejects.toThrow('different embedding identity');
    }
    await expect(
      store(database).vectors.addVectors([[1]], [document(original)]),
    ).rejects.toThrow('dimension');
  });
});
