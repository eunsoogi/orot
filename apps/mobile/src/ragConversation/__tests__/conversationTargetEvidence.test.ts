import {
  includeConversationTarget,
  includeConversationTargets,
} from '../conversationTargetEvidence';

const target = {
  sourceKind: 'personal_record' as const,
  sourceId: 's1',
  sourceRevision: 'sr1',
  evidenceId: 'e1',
  evidenceRevision: 'er1',
  locator: { kind: 'local-evidence' as const, token: 'e1' },
  effectiveTime: null,
  reviewState: 'unreviewed' as const,
  content: 'appointment: {"status":"scheduled"}',
};
const other = {
  ...target,
  sourceId: 's2',
  evidenceId: 'e2',
  locator: { kind: 'local-evidence' as const, token: 'e2' },
};

test('reserves the exact target and reports truncation within the existing evidence limit', () => {
  const batch = {
    items: [other],
    coverage: [
      {
        sourceKind: 'personal_record' as const,
        searchedSourceIds: ['s2'],
        gaps: [],
        truncated: false,
        resultLimit: 1,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  };
  expect(includeConversationTarget(batch, undefined, 1)).toBe(batch);
  expect(() =>
    includeConversationTarget({ ...batch, items: [target] }, target, 2),
  ).toThrow();
  expect(includeConversationTarget(batch, target, 1)).toEqual({
    items: [target],
    coverage: [
      {
        sourceKind: 'personal_record',
        searchedSourceIds: ['s2', 's1'],
        gaps: [],
        truncated: true,
        resultLimit: 1,
        returnedCount: 1,
      },
    ],
    conflicts: [],
  });
});

test('count opt-out keeps all selected and independently retrieved references', () => {
  const selected = Array.from({ length: 25 }, (_, index) => ({
    ...target,
    evidenceId: `selected-${index}`,
    sourceId: `selected-${index}`,
  }));
  const batch = { items: [other], coverage: [], conflicts: [] };
  const result = includeConversationTargets(batch, undefined, selected, null);
  expect(result.items).toEqual([...selected, other]);
  expect(result.coverage[0]?.returnedCount).toBe(26);
  expect(result.coverage[0]?.truncated).toBe(false);
  expect(() =>
    includeConversationTargets(batch, undefined, selected, 8),
  ).toThrow();
  expect(() =>
    includeConversationTargets(batch, undefined, [other], null),
  ).toThrow('ambiguous');
});
