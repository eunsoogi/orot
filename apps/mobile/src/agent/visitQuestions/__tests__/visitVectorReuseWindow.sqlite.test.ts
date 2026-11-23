import { NativeModules } from 'react-native';
import {
  LOCAL_EMBEDDING_IDENTITY,
  type LocalEmbeddingBackend,
} from '@orot/rag';
import { findVerifiedRagVectorIds } from '../../../storage/ragVerifiedVectorReuse';
import { createLocalE5RagService } from '../../../rag/localE5RagService';
import {
  chunk,
  installFingerprint,
  openDatabase,
} from '../../../storage/testSupport/vectorStore';

jest.mock('../../../rag/localE5NativeBackend', () => ({
  localE5NativeBackend: {},
}));
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

test('a page above the one-window limit cannot return an earlier proof after a later digest mutates its map', async () => {
  installFingerprint();
  const f = await openDatabase();
  const backend: LocalEmbeddingBackend = {
    prepare: jest.fn(async (_id, progress) => progress(1, 1)),
    embedBatch: jest.fn(async texts =>
      texts.map(() =>
        Array.from({ length: 384 }, (_, index) => (index ? 0 : 1)),
      ),
    ),
    cancel: jest.fn(),
  };
  const rag = createLocalE5RagService(f.database, backend);
  const page = Array.from({ length: 33 }, (_, i) => chunk('two-window-' + i));
  const first = page[0]!;
  try {
    await rag.index(page);
    const digest = NativeModules.OrotConsentFingerprint
      .sha256 as jest.MockedFunction<(input: string) => Promise<string>>;
    const real = digest.getMockImplementation()!;
    let changed = false;
    digest.mockClear();
    digest.mockImplementation(async input => {
      if (!changed && input.includes('"id":"two-window-32"')) {
        changed = true;
        await f.database.execute(
          'DELETE FROM rag_embedding_sources WHERE chunk_id=?',
          [first.id],
        );
      }
      return real(input);
    });
    const reused = await findVerifiedRagVectorIds(
      f.database,
      LOCAL_EMBEDDING_IDENTITY,
      page,
    );
    expect({ staleFirst: reused.has(first.id), changed }).toEqual({
      staleFirst: false,
      changed: false,
    });
    expect(reused.size).toBe(0);
    expect(digest).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

test('a mixed warm and missing window does not skip reverse map repair during ordinary embedding', async () => {
  installFingerprint();
  const f = await openDatabase();
  const backend: LocalEmbeddingBackend = {
    prepare: jest.fn(async (_id, progress) => progress(1, 1)),
    embedBatch: jest.fn(async texts =>
      texts.map(() =>
        Array.from({ length: 384 }, (_, index) => (index ? 0 : 1)),
      ),
    ),
    cancel: jest.fn(),
  };
  const rag = createLocalE5RagService(f.database, backend);
  const first = chunk('mixed-warm');
  const second = chunk('mixed-missing');
  try {
    await rag.index([first]);
    const work = jest.mocked(backend.embedBatch);
    const embed = work.getMockImplementation()!;
    work.mockClear();
    work.mockImplementationOnce(async (texts, role, requestId) => {
      await f.database.execute(
        'DELETE FROM rag_embedding_sources WHERE chunk_id=?',
        [first.id],
      );
      return embed(texts, role, requestId);
    });
    await rag.index([first, second], { reuseVerifiedVectors: true });
    expect(
      (
        await f.database.execute(
          'SELECT source_record_id FROM rag_embedding_sources WHERE chunk_id=?',
          [first.id],
        )
      ).rows,
    ).toEqual([{ source_record_id: 'source-a' }]);
    expect(work.mock.calls[0]?.[0]).toHaveLength(2);
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});
