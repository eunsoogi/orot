import { unifySavedMemories } from '../unifiedSavedMemories';
import type { ManualHistoryScreenRecord } from '../../manualHistory/types';
const original: ManualHistoryScreenRecord = {
  id: 'synthetic-original',
  kind: 'note',
  title: '합성 기억',
  details: '직접 말한 내용',
  effectiveDate: { status: 'unknown' },
  recordedAt: '2026-01-01T00:00:00Z',
  provenance: { origin: 'user_reported' },
  reviewState: { status: 'unreviewed' },
};
const projection = {
  id: 'synthetic-projection',
  kind: 'task_context' as const,
  text: 'Projection',
  createdAt: 1,
  provenance: {
    sourceIds: [original.id],
    sourceReferences: [{ kind: 'manual_history', id: original.id }],
    reviewState: 'user_confirmed' as const,
  },
};
it('preserves the exact original and unknown date without requiring a projection', () => {
  const rows = unifySavedMemories([], [original]);
  expect(rows).toEqual([
    {
      sourceKind: 'manual_history',
      id: 'manual-history:' + original.id,
      text: original.title + '\n' + original.details,
      createdAt: Date.parse(original.recordedAt),
      record: original,
    },
  ]);
  expect((rows[0] as { record: ManualHistoryScreenRecord }).record).toBe(
    original,
  );
});
it('shows one original instead of its exact single-source projection', () => {
  expect(unifySavedMemories([projection], [original])).toHaveLength(1);
});
it('does not hide memories backed by additional or differently typed sources', () => {
  const multi = {
    ...projection,
    provenance: { ...projection.provenance, sourceIds: [original.id, 'other'] },
  };
  const otherKind = {
    ...projection,
    provenance: {
      ...projection.provenance,
      sourceReferences: [{ kind: 'recording', id: original.id }],
    },
  };
  expect(unifySavedMemories([multi, otherKind], [original])).toHaveLength(3);
});
it('keeps a source-validated memory when no original is returned', () => {
  expect(unifySavedMemories([projection], [])).toEqual([projection]);
});
