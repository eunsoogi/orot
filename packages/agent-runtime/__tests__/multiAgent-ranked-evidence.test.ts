import { hasBlockingCoverage } from '../src/multiAgent/coveragePolicy';
import type { EvidenceBatch } from '../src';

const batch: EvidenceBatch = {
  items: [
    {
      sourceKind: 'personal_record',
      sourceId: 'source',
      sourceRevision: '1',
      evidenceId: 'medication',
      evidenceRevision: '1',
      locator: { kind: 'structured_record', recordId: 'medication' },
      effectiveTime: null,
      reviewState: 'unreviewed',
      content: 'Synthetic medication record',
    },
  ],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['source'],
      gaps: [],
      truncated: true,
      resultLimit: 1,
      returnedCount: 1,
      selectionMethod: 'ranked_retrieval',
    },
  ],
  conflicts: [],
};

test('a task may answer from an honestly bounded ranked search over current records', () => {
  expect(hasBlockingCoverage(batch, false, true)).toBe(false);
  expect(batch.coverage[0].truncated).toBe(true);
});

test('ranked selection never conceals missing inventory, conflicts, or unknown truncation', () => {
  expect(hasBlockingCoverage(batch)).toBe(true);
  expect(hasBlockingCoverage({ ...batch, conflicts: ['Conflicting doses'] }, false, true)).toBe(
    true,
  );
  expect(
    hasBlockingCoverage(
      { ...batch, coverage: [{ ...batch.coverage[0], gaps: ['Unreadable record'] }] },
      false,
      true,
    ),
  ).toBe(true);
  expect(
    hasBlockingCoverage(
      { ...batch, coverage: [{ ...batch.coverage[0], selectionMethod: undefined }] },
      false,
      true,
    ),
  ).toBe(true);
  expect(hasBlockingCoverage({ ...batch, items: [] }, false, true)).toBe(true);
});
