import { HealthObservationSchema } from '@orot/domain';
import type { HybridEvidenceSearchHit } from '@orot/rag';
import type { RecordKind, RecordRepository } from '@orot/storage';
import { createVisitQuestionEvidenceCollection } from '../evidenceCollection';

function observation(
  id: string,
  sourceId: string,
  effectiveAt: string,
  concept: string,
  amount: number,
) {
  return HealthObservationSchema.parse({
    id,
    effectiveAt,
    recordedAt: effectiveAt,
    ingestedAt: '2026-09-02T00:00:00Z',
    provenance: { origin: 'device_recorded', sourceRecordIds: [sourceId] },
    reviewState: { status: 'unreviewed' },
    observationKind: 'measurement',
    concept,
    value: { kind: 'quantity', amount, unit: 'mmHg' },
  });
}

function hit(
  record: ReturnType<typeof observation>,
  sourceId: string,
): HybridEvidenceSearchHit {
  return {
    chunk: {
      id: `chunk-${record.id}`,
      text: `health_observation: ${record.concept}`,
      metadata: {
        sourceId,
        sourceRecordIds: [sourceId],
        evidenceId: record.id,
        evidenceLocator: { kind: 'structured_record', recordId: record.id },
        effectiveTime: record.effectiveAt,
        recordType: 'health_observation',
        reviewState: record.reviewState,
      },
    },
    score: 1,
    lexicalRank: 1,
    vectorRank: 1,
  };
}

function repository(
  observations: readonly ReturnType<typeof observation>[],
): Pick<RecordRepository, 'get'> {
  const sources = new Set(
    observations.map(item => item.provenance.sourceRecordIds[0]),
  );
  const byId = new Map(observations.map(item => [item.id, item]));
  return {
    async get(kind: RecordKind, id: string) {
      if (kind === 'source_record' && sources.has(id)) return { id } as never;
      if (kind === 'health_observation') return byId.get(id) as never;
      return null as never;
    },
  };
}

describe('visit question evidence conflicts', () => {
  it('reports conflicting values for the same measurement and instant across time-zone spellings', async () => {
    const earlier = observation(
      'observation-1',
      'source-1',
      '2026-09-01T09:00:00+09:00',
      'Blood Pressure',
      120,
    );
    const conflicting = observation(
      'observation-2',
      'source-2',
      '2026-09-01T00:00:00Z',
      'blood pressure',
      130,
    );

    const result = await createVisitQuestionEvidenceCollection({
      repository: repository([earlier, conflicting]),
      recordHits: [hit(earlier, 'source-1'), hit(conflicting, 'source-2')],
      transcriptHits: [],
      recordResultLimit: 4,
      transcriptResultLimit: 1,
      memoryResultLimit: 1,
      maxEvidenceItems: 8,
    });

    expect(result.batch.conflicts).toEqual([
      'Conflicting health observation values exist for the same concept and time.',
    ]);
  });

  it('does not report a conflict for the same value or a different instant', async () => {
    const first = observation(
      'observation-1',
      'source-1',
      '2026-09-01T09:00:00+09:00',
      'Blood Pressure',
      120,
    );
    const sameValue = observation(
      'observation-2',
      'source-2',
      '2026-09-01T00:00:00Z',
      'blood pressure',
      120,
    );
    const laterValue = observation(
      'observation-3',
      'source-3',
      '2026-09-01T00:01:00Z',
      'Blood Pressure',
      130,
    );

    const result = await createVisitQuestionEvidenceCollection({
      repository: repository([first, sameValue, laterValue]),
      recordHits: [
        hit(first, 'source-1'),
        hit(sameValue, 'source-2'),
        hit(laterValue, 'source-3'),
      ],
      transcriptHits: [],
      recordResultLimit: 4,
      transcriptResultLimit: 1,
      memoryResultLimit: 1,
      maxEvidenceItems: 8,
    });

    expect(result.batch.conflicts).toEqual([]);
  });
});
