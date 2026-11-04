import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { symptomSummaryTaskForProvider } from '../partitionedSymptomSummaryTask';
import { evidence, reference } from '../taskTestSupport';

test('Apple partition merge retains source-bound selected records and separately cited public context', () => {
  const task = symptomSummaryTaskForProvider(APPLE_PROVIDER_ID);
  const personal = {
    ...reference,
    content:
      'health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"heart_rate","value":{"kind":"quantity","amount":76,"unit":"count/min"}},{"kind":"health_observation","concept":"body_mass","value":{"kind":"quantity","amount":68,"unit":"kg"}}]}',
  };
  const publication = {
    ...reference,
    sourceKind: 'external_medical' as const,
    sourceId: 'paper',
    evidenceId: 'paper',
    content: 'Synthetic public context.',
  };
  const combined = {
    request: '기록 요약',
    evidence: { ...evidence, items: [personal, publication] },
  };
  const personalInput = {
    ...combined,
    evidence: { ...combined.evidence, items: [personal] },
    resultPartition: {
      sourceKind: 'personal_record' as const,
      index: 0,
      total: 2,
    },
  };
  const publicInput = {
    ...combined,
    evidence: { ...combined.evidence, items: [publication] },
    resultPartition: {
      sourceKind: 'external_medical' as const,
      index: 1,
      total: 2,
    },
  };
  const record = {
    recordSelections: [
      {
        sourceId: reference.evidenceId,
        rows: ['r0'],
        limitationCodes: ['subset_only'],
      },
    ],
  };
  const medical = {
    sections: [
      {
        title: '일반 자료',
        summary: '심박수에 관한 일반 설명이에요.',
        supportingEvidence: ['paper'],
        contraryEvidence: [],
        uncertaintyNotes: [],
        missingData: [],
      },
    ],
  };
  expect(task.validateResult(record, personalInput).status).toBe('valid');
  expect(task.validateResult(medical, publicInput).status).toBe('valid');
  const merged = task.finalResultPartition!.mergeValues(
    [record, medical],
    combined,
  );
  const result = task.validateResult(merged, combined);
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') return;
  expect(result.value.hypotheses).toHaveLength(2);
  expect(result.value.hypotheses[0]!.summary).toContain('76');
  expect(result.value.hypotheses[0]!.summary).not.toContain('68');
  expect(result.value.hypotheses[0]!.uncertainty).toBe(
    '조회한 기록에 한정돼요.',
  );
  expect(result.value.hypotheses[1]!.supportingEvidence[0]!.sourceKind).toBe(
    'external_medical',
  );
  expect(result.value.omittedUnsupportedContent).toBe(true);
});
