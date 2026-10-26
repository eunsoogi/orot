import type { EvidenceChunk } from '@orot/rag';
import { STORAGE_TABLES } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { SqlCipherRagEmbeddingStorage } from '../../storage/ragEmbeddingStorage';
import { SqlCipherRagFullTextSearchStore } from '../../storage/ragFullTextSearch';
import { LocalLexicalRetriever } from '../localLexicalRetriever';
import { lexicalChunk } from '../testSupport/lexicalRetrieverFixtures';

describe('lexical retriever with existing SQLite stores', () => {
  let database: SqlDatabase;
  let close: () => void = () => undefined;

  beforeEach(async () => {
    const opened = openSqliteTestDatabase(':memory:');
    database = opened.database;
    close = opened.close;
    // Only identity columns are needed by the existing eligibility lookup.
    // This fixture exercises SQLite/FTS behavior, not SQLCipher encryption or migrations.
    for (const { table } of Object.values(STORAGE_TABLES)) {
      await database.execute(
        `CREATE TABLE ${table} (id TEXT PRIMARY KEY NOT NULL)`,
      );
    }
  });

  afterEach(() => close());

  async function retain(
    chunk: EvidenceChunk,
    rootSourceExists = true,
  ): Promise<void> {
    if (rootSourceExists) {
      await database.execute('INSERT INTO source_records (id) VALUES (?)', [
        chunk.metadata.sourceId,
      ]);
    }
    if (chunk.metadata.evidenceLocator.kind === 'structured_record') {
      await database.execute('INSERT INTO encounters (id) VALUES (?)', [
        chunk.metadata.evidenceLocator.recordId,
      ]);
    }
  }

  it('preserves actual FTS ordering and limits within a filtered candidate page', async () => {
    const first = lexicalChunk('first');
    const second = lexicalChunk('second');
    const excluded = lexicalChunk('excluded');
    // Two candidates share a filter while retaining distinct citation identities.
    const page = [
      first,
      {
        ...second,
        metadata: {
          ...second.metadata,
          encounterId: first.metadata.encounterId,
        },
      },
      excluded,
    ];
    for (const chunk of page) await retain(chunk);
    const textStore = new SqlCipherRagFullTextSearchStore(database);
    const removalReader = new SqlCipherRagEmbeddingStorage(database);
    const expectedOrder = await textStore.search('진료', page.slice(0, 2), 2);
    expect(expectedOrder).toHaveLength(2);
    const search = jest.spyOn(textStore, 'search');
    const retriever = new LocalLexicalRetriever({
      chunks: page,
      textStore,
      removalReader,
      filters: { encounterId: first.metadata.encounterId },
      candidateLimit: 2,
      limit: 1,
    });
    const documents = await retriever.invoke('진료');
    expect(documents.map(document => document.id)).toEqual([
      expectedOrder[0].chunkId,
    ]);
    expect(search).toHaveBeenCalledWith('진료', page.slice(0, 2), 2, undefined);
    expect(documents[0].metadata).toEqual(
      page.find(chunk => chunk.id === documents[0].id)!.metadata,
    );
  });

  it.each([
    'source row',
    'source fence',
    'chunk fence',
    'structured row',
    'external structured row',
  ])(
    'excludes retained evidence after removal of its %s before real FTS search',
    async boundary => {
      const first = lexicalChunk('first');
      let candidate: EvidenceChunk = first;
      if (boundary === 'source row') {
        candidate = {
          ...first,
          metadata: {
            ...first.metadata,
            recordType: 'transcript_segment',
            evidenceLocator: {
              kind: 'audio_time_range',
              startMs: 0,
              endMs: 100,
            },
          },
        };
      } else if (boundary === 'external structured row') {
        candidate = {
          ...first,
          metadata: {
            ...first.metadata,
            sourceId: 'external-sample',
            sourceRecordIds: ['external-sample'],
          },
        };
      }
      const retained = lexicalChunk('retained');
      // External provenance is not a source_records row; its local record is authoritative.
      await retain(candidate, boundary !== 'external structured row');
      await retain(retained);
      const textStore = new SqlCipherRagFullTextSearchStore(database);
      const removalReader = new SqlCipherRagEmbeddingStorage(database);
      const retriever = new LocalLexicalRetriever({
        chunks: [candidate, retained],
        textStore,
        removalReader,
      });
      await expect(retriever.invoke('진료')).resolves.toHaveLength(2);
      if (boundary === 'source row') {
        await database.execute('DELETE FROM source_records WHERE id = ?', [
          candidate.metadata.sourceId,
        ]);
      } else if (
        boundary === 'structured row' ||
        boundary === 'external structured row'
      ) {
        await database.execute('DELETE FROM encounters WHERE id = ?', [
          candidate.metadata.evidenceId,
        ]);
      } else {
        await removalReader.deleteEvidence(
          boundary === 'source fence' ? [candidate.metadata.sourceId] : [],
          boundary === 'chunk fence' ? [candidate.id] : [],
        );
      }
      const search = jest.spyOn(textStore, 'search');
      await expect(retriever.invoke('진료')).resolves.toMatchObject([
        { id: retained.id },
      ]);
      expect(search).toHaveBeenCalledWith('진료', [retained], 20, undefined);
    },
  );
});
