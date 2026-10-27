import { clearEvidenceIndex, deleteEvidenceChunks, chunkStructuredRecord } from '../src';
import type { LocalEmbeddingVectorStore } from '../src';

describe('evidence deletion transaction boundary', () => {
  const store = {
    deleteEvidence: jest.fn(),
    clear: jest.fn(),
  } as unknown as LocalEmbeddingVectorStore;
  const transaction = { execute: jest.fn() };
  beforeEach(() => jest.clearAllMocks());

  it('forwards deduplicated source and chunk fences into the caller transaction', async () => {
    const chunk = chunkStructuredRecord('symptom_entry', {
      id: 'symptom',
      text: 'synthetic',
      provenance: { sourceRecordIds: ['source', 'source'] },
    } as never);
    await deleteEvidenceChunks([chunk, chunk], store, ['explicit', ''], transaction);
    expect(store.deleteEvidence).toHaveBeenCalledWith(
      ['explicit', 'source'],
      [chunk.id],
      transaction,
    );
  });

  it('does not open deletion work for empty identities', async () => {
    await deleteEvidenceChunks([], store, ['']);
    expect(store.deleteEvidence).not.toHaveBeenCalled();
  });

  it('retains deduplicated source fences when clearing all model vectors', async () => {
    await clearEvidenceIndex(store, ['source', '', 'source'], transaction);
    expect(store.clear).toHaveBeenCalledWith(['source'], transaction);
  });
});
