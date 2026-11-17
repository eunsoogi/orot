import { reportCoverageDiagnostics } from '../src/multiAgent/coverageDiagnostics';
import type { EvidenceBatch } from '../src';

const batch = (): EvidenceBatch => ({
  items: [
    {
      sourceKind: 'personal_record',
      sourceId: 'private-id',
      evidenceId: 'private-evidence',
      sourceRevision: '1',
      evidenceRevision: '1',
      locator: {},
      effectiveTime: null,
      reviewState: 'reviewed',
      content: 'private-body',
    },
  ],
  coverage: [
    {
      sourceKind: 'personal_record',
      searchedSourceIds: ['private-id'],
      gaps: [
        'period_detail_exceeds_payload_limit_choose_fewer_topics_or_summary',
        'private-health-gap',
      ],
      truncated: true,
      resultLimit: 3,
      returnedCount: 1,
    },
  ],
  conflicts: ['private-conflict'],
});

test('reports only deduplicated closed tokens without mutating evidence', () => {
  const original = batch();
  const input = { ...original, coverage: [...original.coverage, ...original.coverage] };
  const before = JSON.stringify(input);
  const observer = jest.fn();
  reportCoverageDiagnostics(input, {}, observer);
  expect(observer.mock.calls.flat()).toEqual([
    'coverage_conflict',
    'coverage_personal_unspecified',
    'coverage_personal_gap',
    'coverage_gap_payload',
    'coverage_gap_other',
    'coverage_personal_truncated_blocking',
  ]);
  expect(JSON.stringify(input)).toBe(before);
  expect(JSON.stringify(observer.mock.calls)).not.toContain('private');
});

test.each([
  [
    'personal_record',
    'ranked_retrieval',
    { allowRankedLocalEvidence: true },
    'personal_ranked',
    'personal_truncated_allowed',
  ],
  [
    'generated_artifact',
    'paged_retrieval',
    { allowPagedGeneratedArtifacts: true },
    'artifact_paged',
    'artifact_truncated_allowed',
  ],
  [
    'external_medical',
    undefined,
    { allowBoundedExternalEvidence: true },
    'external_unspecified',
    'external_truncated_allowed',
  ],
  ['reviewed_memory', undefined, {}, 'memory_unspecified', 'memory_truncated_blocking'],
] as const)(
  'uses existing truncation policy for %s',
  (sourceKind, selectionMethod, task, selection, truncation) => {
    const input = batch();
    const scoped = {
      ...input,
      coverage: [{ ...input.coverage[0]!, sourceKind, selectionMethod, gaps: [] }],
    };
    const observer = jest.fn();
    reportCoverageDiagnostics(scoped, task, observer);
    expect(observer.mock.calls.flat()).toContain(`coverage_${selection}`);
    expect(observer.mock.calls.flat()).toContain(`coverage_${truncation}`);
  },
);

test('isolates observer failure and empty evidence without exposing arbitrary strings', () => {
  const observer = jest.fn(() => {
    throw new Error('observer failure');
  });
  expect(() =>
    reportCoverageDiagnostics({ items: [], coverage: [], conflicts: [] }, {}, observer),
  ).not.toThrow();
  expect(observer.mock.calls).toHaveLength(2);
  expect(() => reportCoverageDiagnostics(batch(), {})).not.toThrow();
});
