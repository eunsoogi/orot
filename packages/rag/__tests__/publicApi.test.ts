import * as rag from '../src';

it('exposes standard retrieval and provenance construction without superseded execution APIs', () => {
  expect(rag.HybridRetriever).toBeDefined();
  expect(rag.buildPersistedEvidenceChunks).toBeDefined();
  for (const name of [
    'indexEvidenceChunks',
    'searchEvidenceChunks',
    'searchHybridEvidenceChunks',
  ]) {
    expect(Object.prototype.hasOwnProperty.call(rag, name)).toBe(false);
  }
});
