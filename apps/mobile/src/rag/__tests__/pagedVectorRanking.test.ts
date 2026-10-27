import { localE5NativeBackend } from '../localE5NativeBackend';
import { createLocalE5RagService } from '../localE5RagService';
import { LocalE5Embeddings } from '../localE5Embeddings';
import { SqlCipherVectorStore } from '../../storage/sqlCipherVectorStore';
import { SqlCipherRagFullTextSearchStore } from '../../storage/ragFullTextSearch';
import {
  chunk,
  installFingerprint,
  openDatabase,
} from '../../storage/testSupport/vectorStore';
import { withPrivateCallbackContext } from '../../../../../packages/rag/__tests__/hybridRetriever/fixtures';

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
    .mockImplementation(async (texts, role) =>
      texts.map(text =>
        Array.from({ length: 384 }, (_, i) =>
          i === (role === 'query' || text.includes('winner') ? 0 : 1) ? 1 : 0,
        ),
      ),
    );
});
afterEach(() => jest.restoreAllMocks());

it('keeps large-page query and results out of ambient callbacks', async () => {
  const opened = await openDatabase();
  try {
    const page = Array.from({ length: 501 }, (_, i) =>
      chunk('item-' + i, 'source-a'),
    );
    await withPrivateCallbackContext(async (seen, _handler, consoleLog) => {
      const hits = await createLocalE5RagService(opened.database).search(
        'consultation',
        page,
      );
      expect(hits).toHaveLength(5);
      expect(seen).toEqual([]);
      expect(consoleLog).not.toHaveBeenCalled();
    }, true);
  } finally {
    opened.close();
  }
});

it.each([500, 501, 1001])(
  'keeps the global ranked contract for %i candidates and embeds one query',
  async count => {
    const opened = await openDatabase();
    try {
      const database = opened.database;
      const rag = createLocalE5RagService(database);
      const page = Array.from({ length: count }, (_, i) => ({
        ...chunk('item-' + String(i).padStart(4, '0'), 'source-a'),
        text:
          'consultation ' +
          (i === 0 || i === 500 || i === count - 1 ? 'winner' : 'filler'),
      }));
      await rag.index(page);
      const options = {
        ranking: {
          candidateLimit: 4,
          lexicalWeight: 0.25,
          vectorWeight: 0.75,
          rrfConstant: 1,
        },
      };

      const vector = jest.spyOn(
        SqlCipherVectorStore.prototype,
        'similaritySearchVectorWithScore',
      );
      const lexical = jest.spyOn(
        SqlCipherRagFullTextSearchStore.prototype,
        'search',
      );
      const embed = jest.spyOn(LocalE5Embeddings.prototype, 'embedQuery');
      const actual = await rag.search('consultation', page, 4, options);
      // Independent ranks: all lexical scores tie by ID; only the three winner texts
      // share the query's vector, including winners beyond the first storage page.
      const winnerIds = [0, 500, count - 1].filter(
        (value, index, values) =>
          value < count && values.indexOf(value) === index,
      );
      const vectorOrder = [
        ...winnerIds,
        ...page.map((_, i) => i).filter(i => !winnerIds.includes(i)),
      ];
      const expected = page
        .flatMap((value, i) => {
          const lexicalRank = i < 4 ? i + 1 : null;
          const position = vectorOrder.indexOf(i);
          const vectorRank = position < 4 ? position + 1 : null;
          if (lexicalRank === null && vectorRank === null) return [];
          return [
            {
              chunk: value,
              lexicalRank,
              vectorRank,
              score:
                (lexicalRank === null ? 0 : 0.25 / (1 + lexicalRank)) +
                (vectorRank === null ? 0 : 0.75 / (1 + vectorRank)),
            },
          ];
        })
        .sort(
          (a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id),
        )
        .slice(0, 4);
      expect(actual).toEqual(expected);
      expect(actual[0]).toMatchObject({
        chunk: page[0],
        lexicalRank: 1,
        vectorRank: 1,
        score: 0.5,
      });
      expect(actual.map(hit => hit.chunk.id)).toContain(page[count - 1].id);
      expect(embed).toHaveBeenCalledTimes(1);
      expect(lexical).toHaveBeenCalledTimes(1);
      expect(lexical.mock.calls[0][1]).toHaveLength(count);
      expect(vector).toHaveBeenCalledTimes(Math.ceil(count / 500));
      const requested = vector.mock.calls.flatMap(([, , filter]) => {
        expect(filter!.candidates.length).toBeLessThanOrEqual(500);
        return filter!.candidates.map(value => value.id);
      });
      expect(requested).toEqual(page.map(value => value.id));
    } finally {
      opened.close();
    }
  },
);

it('accepts blank and filtered large pages without widening the selected evidence', async () => {
  const opened = await openDatabase();
  try {
    const rag = createLocalE5RagService(opened.database);
    const page = Array.from({ length: 501 }, (_, i) =>
      chunk('item-' + i, 'source-a'),
    );
    page[0] = {
      ...page[0],
      metadata: { ...page[0].metadata, recordType: 'encounter' },
    };
    await rag.index([page[0]]);
    const embed = jest.spyOn(LocalE5Embeddings.prototype, 'embedQuery');
    expect(await rag.search('', page)).toEqual([]);
    expect(embed).not.toHaveBeenCalled();
    const hits = await rag.search('consultation', page, 5, {
      filters: { recordTypes: ['encounter'] },
    });
    expect(hits).toEqual([
      { chunk: page[0], score: 1 / 61, lexicalRank: 1, vectorRank: 1 },
    ]);
    await rag.deleteChunks([], ['source-a']);
    expect(await rag.search('consultation', page)).toEqual([]);
    expect(embed).toHaveBeenCalledTimes(1);
  } finally {
    opened.close();
  }
});
