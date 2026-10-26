import { localE5NativeBackend } from '../localE5NativeBackend';
import { createLocalE5RagService } from '../localE5RagService';
import { SqlCipherVectorStore } from '../../storage/sqlCipherVectorStore';
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

beforeEach(() => {
  jest.clearAllMocks();
  installFingerprint();
  jest.mocked(localE5NativeBackend.prepare).mockImplementation(async () => {});
  jest
    .mocked(localE5NativeBackend.embedBatch)
    .mockImplementation(async texts =>
      texts.map(() => Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0))),
    );
});
afterEach(() => jest.restoreAllMocks());

function gate() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, release };
}

it.each(['abort', 'failure'])(
  'discards earlier pages after a later-page %s and releases the transaction',
  async reason => {
    const opened = await openDatabase();
    try {
      const database = opened.database;
      const rag = createLocalE5RagService(database);
      const page = Array.from({ length: 501 }, (_, i) =>
        chunk('item-' + i, 'source-a'),
      );
      await rag.index(page);
      const controller = new AbortController();
      const original =
        SqlCipherVectorStore.prototype.similaritySearchVectorWithScore;
      let calls = 0;
      jest
        .spyOn(
          SqlCipherVectorStore.prototype,
          'similaritySearchVectorWithScore',
        )
        .mockImplementation(async function (
          this: SqlCipherVectorStore,
          ...args
        ) {
          const hits = await original.apply(this, args);
          if (++calls === 2) {
            if (reason === 'abort') controller.abort();
            else throw new Error('Synthetic later-page failure');
          }
          return hits;
        });
      const result = rag.search('consultation', page, 5, {
        signal: controller.signal,
      });
      await expect(result).rejects.toMatchObject(
        reason === 'abort'
          ? { name: 'AbortError' }
          : { message: 'Synthetic later-page failure' },
      );
      expect(calls).toBe(2);
      // A following transaction really commits; an abandoned owner/connection would hang or fail here.
      await database.transaction(async tx => {
        await tx.execute('DELETE FROM source_records WHERE id = ?', [
          'source-a',
        ]);
      });
      expect(await rag.search('consultation', page)).toEqual([]);
    } finally {
      opened.close();
    }
  },
);

it.each(['revision', 'source deletion'])(
  'keeps a queued %s writer outside the page transaction and retains the final deletion fence',
  async boundary => {
    const opened = await openDatabase();
    try {
      const database = opened.database;
      const rag = createLocalE5RagService(database);
      const page = Array.from({ length: 501 }, (_, i) =>
        chunk('item-' + String(i).padStart(4, '0'), 'source-a'),
      );
      await rag.index(page);
      const changed = { ...page[0], text: 'corrected synthetic consultation' };
      const candidates = [changed, ...page.slice(1)];
      const entered = gate();
      const resume = gate();
      const events: string[] = [];
      let writer!: Promise<void>;
      const original =
        SqlCipherVectorStore.prototype.similaritySearchVectorWithScore;
      let calls = 0;
      jest
        .spyOn(
          SqlCipherVectorStore.prototype,
          'similaritySearchVectorWithScore',
        )
        .mockImplementation(async function (
          this: SqlCipherVectorStore,
          ...args
        ) {
          const hits = await original.apply(this, args);
          events.push('page-' + ++calls);
          if (calls === 1) {
            // Queue a relevant production-style revision replacement while the outer read owner is active.
            writer = database.transaction(async tx => {
              events.push('writer');
              if (boundary === 'revision')
                await tx.execute(
                  'DELETE FROM rag_vector_document_revisions WHERE chunk_id = ?',
                  [page[500].id],
                );
              else
                await tx.execute('DELETE FROM source_records WHERE id = ?', [
                  'source-a',
                ]);
            });
            entered.release();
            await resume.promise;
          }
          return hits;
        });
      const searching = rag.search('unmatched-token', candidates, 500, {
        ranking: { candidateLimit: 500 },
      });
      await entered.promise;
      expect(events).toEqual(['page-1']);
      resume.release();
      const hits = await searching;
      await writer;
      expect(events).toEqual(['page-1', 'page-2', 'writer']);
      if (boundary === 'source deletion') {
        expect(hits).toEqual([]);
        return;
      }
      expect(hits).toHaveLength(500);
      expect(hits[0]).toMatchObject({
        chunk: page[1],
        lexicalRank: null,
        vectorRank: 1,
      });
      expect(hits[499]).toMatchObject({ chunk: page[500], vectorRank: 500 });
      // This is the existing revision-at-read contract: a subsequent search sees the committed replacement.
      expect((await rag.search('unmatched-token', [page[500]])).length).toBe(0);
    } finally {
      opened.close();
    }
  },
);
