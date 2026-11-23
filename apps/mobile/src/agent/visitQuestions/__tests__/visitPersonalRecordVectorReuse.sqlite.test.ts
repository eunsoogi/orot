import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { NativeModules } from 'react-native';
import type { LocalEmbeddingBackend } from '@orot/rag';
import { createLocalE5RagService } from '../../../rag/localE5RagService';
import { SqlCipherVectorStore } from '../../../storage/sqlCipherVectorStore';
import {
  chunk,
  installFingerprint,
  openDatabase,
} from '../../../storage/testSupport/vectorStore';
import { searchVisitQuestionEvidence } from '../evidenceSearch';
import type { VisitQuestionEvidenceRepository } from '../evidenceRevalidation';

jest.mock('../../../rag/localE5NativeBackend', () => ({
  localE5NativeBackend: {},
}));
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

test('warm Visit personal-record search reuses only an entirely verified candidate window', async () => {
  installFingerprint();
  const db = await openDatabase();
  const backend: LocalEmbeddingBackend = {
    prepare: jest.fn(async (_id, progress) => progress(1, 1)),
    embedBatch: jest.fn(async texts =>
      texts.map(() =>
        Array.from({ length: 384 }, (_, index) => (index ? 0 : 1)),
      ),
    ),
    cancel: jest.fn(),
  };
  const rag = createLocalE5RagService(db.database, backend);
  const stored = jest.spyOn(SqlCipherVectorStore.prototype, 'addVectors');
  const page = Array.from({ length: 24 }, (_, i) => chunk('selected-' + i));
  const search = jest.fn(async () => []);
  const run = (chunks = page, signal = new AbortController().signal) =>
    searchVisitQuestionEvidence({
      query: 'synthetic consultation',
      maxEvidenceItems: 5,
      sourceKind: 'personal_record',
      repository: {} as VisitQuestionEvidenceRepository,
      rag: { index: rag.index, search },
      buildChunks: async () => chunks,
      signal,
    });
  try {
    await run();
    expect(backend.embedBatch).toHaveBeenCalledTimes(6);
    expect(stored).toHaveBeenCalledTimes(6);
    const baselineRanks = await rag.search('consultation', page, 5);
    expect(baselineRanks).toHaveLength(5);
    jest.clearAllMocks();
    await run();
    expect(backend.prepare).not.toHaveBeenCalled();
    expect(backend.embedBatch).not.toHaveBeenCalled();
    expect(stored).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledWith(
      'synthetic consultation',
      page,
      6,
      expect.any(Object),
    );
    expect(await rag.search('consultation', page, 5)).toEqual(baselineRanks);
    jest.clearAllMocks();
    const revised = { ...page[0]!, text: 'changed synthetic consultation' };
    const corrected = [revised, ...page.slice(1)];
    await run(corrected);
    expect(backend.embedBatch).toHaveBeenCalledTimes(6);
    expect(stored).toHaveBeenCalledTimes(6);
    expect(search).toHaveBeenLastCalledWith(
      'synthetic consultation',
      corrected,
      6,
      expect.any(Object),
    );

    jest.clearAllMocks();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(run(corrected, cancelled.signal)).rejects.toThrow('cancelled');
    expect(backend.embedBatch).not.toHaveBeenCalled();
    expect(search).not.toHaveBeenCalled();

    await rag.deleteChunks([revised], ['source-a']);
    await expect(run([revised])).rejects.toThrow('Removed evidence');
    expect(search).not.toHaveBeenCalled();
  } finally {
    jest.restoreAllMocks();
    db.close();
  }
});

it.each(['deletion', 'abort'] as const)(
  'retires an in-flight reuse proof after %s during hashing',
  async boundary => {
    installFingerprint();
    const db = await openDatabase();
    const backend: LocalEmbeddingBackend = {
      prepare: jest.fn(async (_id, progress) => progress(1, 1)),
      embedBatch: jest.fn(async texts =>
        texts.map(() =>
          Array.from({ length: 384 }, (_, index) => (index ? 0 : 1)),
        ),
      ),
      cancel: jest.fn(),
    };
    const writer = createLocalE5RagService(db.database, backend);
    const same = chunk('race', 'source-a');
    const controller = new AbortController();
    try {
      await writer.index([same]);
      jest.clearAllMocks();
      // Opening a new adapter must read the same persisted proof, not a JS cache.
      const reopened = createLocalE5RagService(db.database, backend);
      await reopened.index([same], { reuseVerifiedVectors: true });
      expect(backend.embedBatch).not.toHaveBeenCalled();
      const digest = NativeModules.OrotConsentFingerprint
        .sha256 as jest.MockedFunction<(input: string) => Promise<string>>;
      const real = digest.getMockImplementation()!;
      digest.mockImplementationOnce(async input => {
        if (boundary === 'deletion')
          await writer.deleteChunks([same], ['source-a']);
        else controller.abort();
        return real(input);
      });
      const outcome = reopened.index([same], {
        reuseVerifiedVectors: true,
        signal: controller.signal,
      });
      if (boundary === 'deletion') {
        await expect(outcome).rejects.toThrow('Removed evidence');
        expect(await reopened.search('consultation', [same])).toEqual([]);
      } else {
        await expect(outcome).rejects.toMatchObject({ name: 'AbortError' });
        expect(backend.embedBatch).not.toHaveBeenCalled();
      }
    } finally {
      jest.restoreAllMocks();
      db.close();
    }
  },
);

test('cold adapter reuses only a valid persisted identity and rejects duplicate input IDs first', async () => {
  installFingerprint();
  const directory = mkdtempSync(join(tmpdir(), 'orot-visit-vector-reuse-'));
  const path = join(directory, 'index.sqlite');
  let db = await openDatabase(path);
  const backend: LocalEmbeddingBackend = {
    prepare: jest.fn(async (_id, progress) => progress(1, 1)),
    embedBatch: jest.fn(async texts =>
      texts.map(() =>
        Array.from({ length: 384 }, (_, index) => (index ? 0 : 1)),
      ),
    ),
    cancel: jest.fn(),
  };
  const entry = chunk('cold-proof');
  try {
    await createLocalE5RagService(db.database, backend).index([entry]);
    db.close();
    db = await openDatabase(path);
    const reopened = createLocalE5RagService(db.database, backend);
    jest.clearAllMocks();
    await expect(
      reopened.index([entry, entry], { reuseVerifiedVectors: true }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await reopened.index([entry], { reuseVerifiedVectors: true });
    expect(backend.embedBatch).not.toHaveBeenCalled();
    await db.database.execute(
      'UPDATE rag_vector_document_revisions SET fingerprint=? WHERE chunk_id=?',
      ['0'.repeat(64), entry.id],
    );
    await reopened.index([entry], { reuseVerifiedVectors: true });
    expect(backend.embedBatch).toHaveBeenCalledTimes(1);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
