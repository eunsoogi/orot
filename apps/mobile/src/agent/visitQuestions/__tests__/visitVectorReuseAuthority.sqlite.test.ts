import { NativeModules } from 'react-native';
import type { LocalEmbeddingBackend } from '@orot/rag';
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

test.each(['already-quarantined', 'during-proof'] as const)(
  'warm reuse retains writer-side provenance admission when a symptom alias is %s',
  async timing => {
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
    const base = chunk('provenance-alias');
    const selected = {
      ...base,
      metadata: {
        ...base.metadata,
        sourceRecordIds: ['source-a', 'ambiguous-symptom'],
      },
    };
    const quarantine = async () => {
      await f.database.execute(
        'CREATE TABLE IF NOT EXISTS legacy_symptom_deleted (id TEXT PRIMARY KEY)',
      );
      await f.database.execute(
        "INSERT OR IGNORE INTO legacy_symptom_deleted(id) VALUES ('ambiguous-symptom')",
      );
    };
    try {
      await rag.index([selected]);
      if (timing === 'already-quarantined') await quarantine();
      else {
        const digest = NativeModules.OrotConsentFingerprint
          .sha256 as jest.MockedFunction<(input: string) => Promise<string>>;
        const real = digest.getMockImplementation()!;
        digest.mockImplementationOnce(async input => {
          await quarantine();
          return real(input);
        });
      }
      await expect(
        rag.index([selected], { reuseVerifiedVectors: true }),
      ).rejects.toThrow('Removed symptom evidence');
      await expect(rag.index([selected])).rejects.toThrow(
        'Removed symptom evidence',
      );
    } finally {
      jest.restoreAllMocks();
      f.close();
    }
  },
);

test.each(['missing', 'extra', 'during-proof'] as const)(
  'warm reuse repairs a %s reverse source mapping before later exact-source removal',
  async corruption => {
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
    const selected = chunk('reverse-map');
    const removeMap = async () => {
      await f.database.execute(
        'DELETE FROM rag_embedding_sources WHERE chunk_id=?',
        [selected.id],
      );
    };
    try {
      await rag.index([selected]);
      if (corruption === 'missing') await removeMap();
      else if (corruption === 'extra')
        await f.database.execute(
          'INSERT INTO rag_embedding_sources (chunk_id,source_record_id) VALUES (?,?)',
          [selected.id, 'extra-source'],
        );
      else {
        const digest = NativeModules.OrotConsentFingerprint
          .sha256 as jest.MockedFunction<(input: string) => Promise<string>>;
        const real = digest.getMockImplementation()!;
        digest.mockImplementationOnce(async input => {
          await removeMap();
          return real(input);
        });
      }
      jest.mocked(backend.embedBatch).mockClear();
      await rag.index([selected], { reuseVerifiedVectors: true });
      expect(backend.embedBatch).toHaveBeenCalledTimes(1);
      expect(
        (
          await f.database.execute(
            'SELECT source_record_id FROM rag_embedding_sources WHERE chunk_id=? ORDER BY source_record_id',
            [selected.id],
          )
        ).rows,
      ).toEqual([{ source_record_id: 'source-a' }]);
      await rag.deleteChunks([], ['source-a']);
      expect(
        (
          await f.database.execute(
            'SELECT chunk_id FROM rag_embeddings WHERE chunk_id=?',
            [selected.id],
          )
        ).rows,
      ).toEqual([]);
    } finally {
      jest.restoreAllMocks();
      f.close();
    }
  },
);

test('warm reuse preserves a known different-kind same-ID source independent of legacy symptom quarantine', async () => {
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
  const selected = chunk('typed-same-id');
  try {
    await f.database.execute(
      'CREATE TABLE IF NOT EXISTS legacy_symptom_deleted (id TEXT PRIMARY KEY)',
    );
    await f.database.execute(
      "INSERT OR IGNORE INTO legacy_symptom_deleted(id) VALUES ('source-a')",
    );
    // The only matching source identity is explicitly a source_record.
    await rag.index([selected]);
    jest.mocked(backend.embedBatch).mockClear();
    await rag.index([selected], { reuseVerifiedVectors: true });
    expect(backend.embedBatch).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});
