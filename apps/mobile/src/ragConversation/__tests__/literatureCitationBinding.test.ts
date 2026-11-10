import { literatureCitationsMatch } from '../literatureCitationBinding';

const source = {
  sourceKind: 'external_medical' as const,
  sourceId: 'europe-pmc',
  sourceRevision: 'r1',
  evidenceId: 'MED:1',
  evidenceRevision: 'e1',
  locator: {},
  effectiveTime: null,
  reviewState: 'unknown' as const,
};
const local = {
  ...source,
  sourceKind: 'personal_record' as const,
  sourceId: 'local',
  evidenceId: 'record',
};

test('requires every displayed literature source to be cited at the same revision', () => {
  expect(literatureCitationsMatch([source], [source])).toBe(true);
  expect(literatureCitationsMatch([source], [local])).toBe(false);
  expect(
    literatureCitationsMatch(
      [source],
      [{ ...source, evidenceRevision: 'stale' }],
    ),
  ).toBe(false);
  expect(literatureCitationsMatch([], [source])).toBe(false);
  expect(literatureCitationsMatch([], [local])).toBe(true);
});
