import type { DailyReportSourceRecord } from '@orot/domain';
import { mapBloodPressureCorrelation } from '../../../healthkit/bloodPressure/mapper';
import { bloodPressureSampleTypeIdentifiers as ids } from '../../../healthkit/bloodPressure/types';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceQueries';
import { dailyReportGuidance } from '../dailyReportGuidance';

// Exercise the actual importer boundary: a legitimate cuff sample is not a
// cumulative interval quantity and must survive with its exact source times.
test.each([
  ['2035-01-01T10:00:00+09:00', '2035-01-01T10:00:01+09:00'],
  ['2035-01-01T10:00:00+09:00', '2035-01-01T01:00:00.000Z'],
])(
  'mapped severe pressure retains guidance across %s to %s',
  (startDate, endDate) => {
    const mapped = mapBloodPressureCorrelation(
      {
        id: 'synthetic-cuff',
        typeIdentifier: ids.correlation,
        startDate,
        endDate,
        sourceIdentifier: 'test.synthetic.cuff',
        sourceName: 'Synthetic cuff',
        components: [
          {
            id: 'synthetic-systolic',
            sourceIdentifier: 'test.synthetic.cuff',
            sourceName: 'Synthetic cuff',
            typeIdentifier: ids.systolic,
            startDate,
            endDate,
            value: 190,
            unit: 'mmHg',
          },
        ],
      },
      '2035-01-01T02:00:00Z',
    );
    const values: LocalHealthEvidenceRecord[] = mapped.observations.map(
      record => ({ kind: 'health_observation', record }),
    );
    // A concurrent interval step sample must not result in an exercise suggestion
    // when the report contains a severe pressure needing immediate verification.
    values.push({
      kind: 'health_observation',
      record: {
        ...mapped.observations[0]!,
        id: 'synthetic-steps',
        concept: 'step_count',
        value: { kind: 'quantity', amount: 8, unit: 'count' },
      },
    });
    const sources: DailyReportSourceRecord[] = values.map(v => ({
      source: v.kind,
      recordId: v.record.id,
      revision: '1',
      occurrence: {
        startInclusive: v.record.effectiveAt!,
        endExclusive:
          v.kind === 'health_observation' ? v.record.endedAt : undefined,
      },
      ingestedAt: v.record.ingestedAt,
    }));
    const result = dailyReportGuidance(values, sources);
    expect(result).toHaveLength(1);
    expect(result[0]?.text).toContain('119');
    expect(result[0]?.text).toContain('등 통증·저림·힘 빠짐');
    expect(result[0]?.text).toContain('나열한 증상이 전부는 아니');
    expect(result[0]?.text).not.toContain('움직임부터');
    expect(result[0]?.sourceReferences).toEqual([
      { source: 'health_observation', recordId: mapped.observations[0]!.id },
    ]);
    expect(mapped.observations[0]?.endedAt).toBe(endDate);
  },
);
