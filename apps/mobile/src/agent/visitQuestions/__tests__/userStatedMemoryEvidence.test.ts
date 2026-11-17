import { mapMemoryHitToVisitQuestionEvidence } from '../evidence';
import { searchReviewedMemoryFromStore } from '../reviewedMemorySearch';
const provenance = {
  sourceIds: ['original'],
  sourceReferences: [{ kind: 'manual_history', id: 'original' }],
  sourceDates: [{ sourceId: 'original', date: '2026-11-01T00:00:00Z' }],
  reviewState: 'user_stated',
};
const hit = {
  id: 'memory',
  text: 'Synthetic dated user statement, not a diagnosis',
  score: 1,
  kind: 'task_context' as const,
  createdAt: 1,
  provenance,
};
test('visit memory retrieval preserves unreviewed user-stated trust', async () => {
  const store = {
    search: async () => [
      {
        key: 'synthetic-key',
        value: { ...hit, memoryKey: 'synthetic-key' },
        score: 1,
      },
    ],
  } as never;
  const result = await searchReviewedMemoryFromStore(store, 'Synthetic', 3);
  expect(result.hits).toHaveLength(1);
  expect(
    mapMemoryHitToVisitQuestionEvidence(result.hits[0])?.item.reviewState,
  ).toBe('unreviewed');
  expect(
    mapMemoryHitToVisitQuestionEvidence({
      ...hit,
      provenance: { ...provenance, reviewState: 'human_reviewed' },
    })?.item.reviewState,
  ).toBe('reviewed');
});
