import type { VisitQuestionEvidenceItem } from '../taskContract';
import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';
import { DoseEventSchema } from '@orot/domain';
import { chunkStructuredRecord } from '@orot/rag';

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

  it('removes structured record IDs from provider content and keeps the local citation', () => {
    const doseEvent = DoseEventSchema.parse({
      id: 'private-dose-event-id',
      effectiveAt: '2026-09-01T12:00:00.000Z',
      recordedAt: '2026-09-01T12:00:00.000Z',
      ingestedAt: '2026-09-01T12:00:00.000Z',
      provenance: {
        origin: 'user_reported',
        sourceRecordIds: ['private-source-record-id'],
      },
      reviewState: { status: 'unreviewed' },
      eventKind: 'taken',
      medicationAssertionId: 'private-medication-assertion-id',
      dose: { amount: 5, unit: 'mg' },
    });
    const chunk = chunkStructuredRecord('dose_event', doseEvent);
    const original = {
      ...evidence('private-source-record-id', doseEvent.id),
      content: chunk.text,
    };
    const aliases = createVisitQuestionEvidenceAliases({
      items: [original],
      coverage: [],
      conflicts: [],
    });
    const providerItem = aliases.batch.items[0]!;

    expect(providerItem.content).toContain('"dose":{"amount":5,"unit":"mg"}');
    expect(providerItem.content).not.toContain('medicationAssertionId');
    expect(providerItem.content).not.toContain(
      'private-medication-assertion-id',
    );
    expect(aliases.originalOf(providerItem)).toEqual(original);

    const rawJsonAliases = createVisitQuestionEvidenceAliases({
      items: [
        {
          ...original,
          content: JSON.stringify({
            medicationAssertionId: 'private-medication-assertion-id',
          }),
        },
      ],
      coverage: [],
      conflicts: [],
    });
    expect(rawJsonAliases.batch.items[0]?.content).not.toContain(
      'private-medication-assertion-id',
    );
  });
});
