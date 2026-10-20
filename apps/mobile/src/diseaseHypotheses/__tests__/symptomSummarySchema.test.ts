import { createSymptomSummarySchema } from '../symptomSummarySchema';
import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence, hypothesis, reference } from '../taskTestSupport';

test('requires personal facts and public medical lookup for the explicitly web-assisted summary', () => {
  expect(symptomSummaryTask.requiredToolEvidenceKinds).toEqual([
    'personal_record',
    'external_medical',
  ]);
});

test('guides both citation arrays with exact IDs from the current evidence only', () => {
  const schema = JSON.parse(
    JSON.stringify(
      createSymptomSummarySchema({ request: '합성 요약', evidence }),
    ),
  );
  const properties = schema.properties.sections.items.properties;
  expect(properties.supportingEvidence.items).toEqual({
    type: 'string',
    enum: [reference.evidenceId],
  });
  expect(properties.contraryEvidence.items).toEqual({
    type: 'string',
    enum: [reference.evidenceId],
  });
  expect(properties.contraryEvidence.minItems).toBeUndefined();
  expect(properties.summary.maxLength).toBe(1200);
  expect(schema.properties.sections.items.required).not.toContain(
    'uncertainty',
  );
  expect(schema.properties.sections.items.required).not.toContain(
    'missingData',
  );
  expect(properties.contraryEvidence.maxItems).toBe(0);
  const next = createSymptomSummarySchema({
    request: '합성 요약',
    evidence: {
      ...evidence,
      items: [{ ...evidence.items[0]!, evidenceId: 'next-current-id' }],
    },
  });
  expect(JSON.stringify(next)).toContain('next-current-id');
  expect(JSON.stringify(next)).not.toContain(reference.evidenceId);
});

test('generation guidance never substitutes for local citation validation', () => {
  const result = symptomSummaryTask.validateResult(
    {
      sections: [hypothesis({ supportingEvidence: ['outside-current-batch'] })],
    },
    { request: '합성 요약', evidence },
  );
  expect(result.status).toBe('invalid');
});
