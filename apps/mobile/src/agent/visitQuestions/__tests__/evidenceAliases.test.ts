import type { VisitQuestionEvidenceItem } from '../taskContract';
import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';

function evidence(
  sourceId: string,
  evidenceId: string,
): VisitQuestionEvidenceItem {
  return {
    sourceKind: 'personal_record',
    sourceId,
    sourceRevision: `revision:${sourceId}`,
    evidenceId,
    evidenceRevision: `revision:${evidenceId}`,
    locator: { kind: 'record', id: evidenceId },
    effectiveTime: '2026-09-01T12:00:00.000Z',
    reviewState: 'reviewed',
    content: '최근 검사 결과를 기록했어요.',
  };
}

describe('visit-question evidence aliases', () => {
  it('keeps aliases stable across a local search batch and restores exact citations', () => {
    const first = evidence('private-source-a', 'private-evidence-a');
    const later = evidence('private-source-b', 'private-evidence-b');
    const aliases = createVisitQuestionEvidenceAliases({
      items: [first],
      coverage: [
        {
          sourceKind: 'personal_record',
          searchedSourceIds: [first.sourceId],
          gaps: [],
          truncated: false,
          resultLimit: 2,
          returnedCount: 1,
        },
      ],
      conflicts: [],
    });

    const laterBatch = aliases.aliasBatch({
      items: [later],
      coverage: [
        {
          sourceKind: 'personal_record',
          searchedSourceIds: [later.sourceId],
          gaps: [],
          truncated: false,
          resultLimit: 2,
          returnedCount: 1,
        },
      ],
      conflicts: ['private-source-b: conflicting value'],
    });

    expect(aliases.batch.items[0]?.evidenceId).toBe('evidence-1');
    expect(laterBatch.items[0]?.evidenceId).toBe('evidence-2');
    expect(JSON.stringify(laterBatch)).not.toContain('private-source-b');
    expect(JSON.stringify(laterBatch)).not.toContain('private-evidence-b');
    expect(laterBatch.conflicts).toEqual([
      'The evidence contains a material conflict.',
    ]);
    expect(aliases.originalOf(laterBatch.items[0]!)).toEqual(later);
    expect(aliases.aliasOf(later)).toEqual(laterBatch.items[0]);
    expect(
      aliases.aliasBatch({
        items: [first, later],
        coverage: [],
        conflicts: [],
      }).items,
    ).toEqual([...aliases.batch.items, ...laterBatch.items]);
  });
});
