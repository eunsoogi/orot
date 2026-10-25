import type { EvidenceChunk } from '@orot/rag';
import { LocalEmbeddingJobError } from '@orot/rag';
import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { SqlCipherRagFullTextSearchStore } from '../ragFullTextSearch';

function chunk(id: string, text: string): EvidenceChunk {
  return {
    id,
    text,
    metadata: {
      sourceId: id,
      sourceRecordIds: [id],
      evidenceId: id,
      evidenceLocator: { kind: 'structured_record', recordId: id },
      effectiveTime: '2026-01-02T08:00:00.000Z',
      recordType: 'health_observation',
      reviewState: { status: 'unreviewed' },
    },
  };
}

describe('SQLCipher RAG full-text search storage', () => {
  let database: SqlDatabase;
  let close: () => void = () => undefined;

  beforeEach(() => {
    const opened = openSqliteTestDatabase(':memory:');
    database = opened.database;
    close = opened.close;
  });

  afterEach(() => close());

  it('searches current Korean and English chunks through FTS5 in the memory-only TEMP store', async () => {
    const search = new SqlCipherRagFullTextSearchStore(database);
    const korean = chunk('korean', '혈압약 복용 기록');
    const english = chunk('english', 'blood pressure observation');

    await expect(
      search.search('혈압약', [korean, english], 5),
    ).resolves.toEqual([{ chunkId: 'korean' }]);
    await expect(
      search.search('pressure', [korean, english], 5),
    ).resolves.toEqual([{ chunkId: 'english' }]);

    const temporaryTables = await database.execute(
      "SELECT name FROM sqlite_temp_master WHERE name LIKE 'rag_fts_query_%'",
    );
    const persistentTables = await database.execute(
      "SELECT name FROM sqlite_master WHERE name LIKE 'rag_fts_query_%'",
    );
    const tempStore = await database.execute('PRAGMA temp_store');
    expect(temporaryTables.rows).toEqual([]);
    expect(persistentTables.rows).toEqual([]);
    expect(tempStore.rows[0]).toEqual({ temp_store: 2 });
  });

  it('rebuilds the temporary index from each current chunk snapshot and safely handles operators', async () => {
    const search = new SqlCipherRagFullTextSearchStore(database);
    const first = chunk('first', 'synthetic keyword document');
    const replacement = chunk('replacement', 'a different source note');

    await expect(search.search('keyword', [first], 5)).resolves.toEqual([
      { chunkId: 'first' },
    ]);
    await expect(search.search('" OR *: *', [replacement], 5)).resolves.toEqual(
      [],
    );
    await expect(search.search('keyword', [replacement], 5)).resolves.toEqual(
      [],
    );
  });

  it('rejects invalid limits and duplicate chunk identities', async () => {
    const search = new SqlCipherRagFullTextSearchStore(database);
    const value = chunk('same', 'synthetic value');

    await expect(search.search('value', [value], 0)).rejects.toBeInstanceOf(
      LocalEmbeddingJobError,
    );
    await expect(search.search('value', [value, value], 5)).rejects.toThrow(
      'Full-text search needs unique chunk IDs and non-empty text.',
    );
  });
});
