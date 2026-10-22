import type { JsonValue } from '@orot/model-runtime';
import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence, hypothesis, reference } from '../taskTestSupport';
import { validateDiseaseHypothesisResult } from '../resultValidation';

const input = { request: '저장된 증상 기록 요약', evidence };
const section = hypothesis({
  title: '기록된 증상',
  summary: '원문에 증상 경과가 기록되어 있어요.',
  supportingEvidence: [reference.evidenceId],
});

test('gives the responder an explicit display time zone without rewriting source timestamps', () => {
  const messages = symptomSummaryTask.createMessages!(input);
  const message = messages[0];
  if (message?.role !== 'user')
    throw new Error('Expected the summary request.');
  const payload = JSON.parse(message.content as string);
  expect(payload.displayTimeZone).toBe(
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  expect(payload.records[0].effectiveTime).toBe(reference.effectiveTime);
});

test('preserves authoritative source kinds when rebuilding a final response from mixed evidence', () => {
  const publication = {
    ...reference,
    sourceKind: 'external_medical' as const,
    evidenceId: 'publication-alias',
    content: 'Synthetic publication abstract.',
  };
  const messages = symptomSummaryTask.createMessages!({
    ...input,
    evidence: { ...evidence, items: [...evidence.items, publication] },
  });
  const message = messages[0];
  if (message?.role !== 'user') throw new Error('Expected summary input.');
  const payload = JSON.parse(message.content as string);
  expect(symptomSummaryTask.nativeToolResultMode).toBe('evidence_references');
  expect(
    payload.records.map((item: { content: string }) => item.content),
  ).toEqual([...evidence.items, publication].map(item => item.content));
  expect(payload.coverage).toEqual(evidence.coverage);
  // Content and titles cannot reliably identify provenance after tool-call history is rebuilt.
  expect(
    payload.records.map(
      ({ evidenceId, sourceKind }: Record<string, string>) => ({
        evidenceId,
        sourceKind,
      }),
    ),
  ).toEqual([
    { evidenceId: reference.evidenceId, sourceKind: 'personal_record' },
    { evidenceId: publication.evidenceId, sourceKind: 'external_medical' },
  ]);
  expect(
    payload.records.every(
      (item: Record<string, unknown>) => !('sourceId' in item),
    ),
  ).toBe(true);
});

test.each([
  ['예시약 복용 확인.', 'invalid'],
  ['예시약을 복용했어요.', 'invalid'],
  ['예시약이 등록되어 있어요. 개별 복용 완료는 확인할 수 없어요.', 'valid'],
])(
  'distinguishes medication registration from use: %s',
  (summary, expected) => {
    const result = symptomSummaryTask.validateResult(
      { sections: [{ ...section, summary }] } as JsonValue,
      {
        ...input,
        evidence: {
          ...evidence,
          items: [
            {
              ...reference,
              content:
                'medication_definition: {"displayText":"예시약","hasSchedule":true}',
            },
          ],
        },
      },
    );
    expect(result.status).toBe(expected);
  },
);

test('restores exact references for a separately identified factual summary', () => {
  const result = symptomSummaryTask.validateResult(
    { sections: [section] } as JsonValue,
    input,
  );
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.presentation).toBe('symptom_summary');
    expect(result.value.hypotheses[0]?.supportingEvidence).toEqual([reference]);
    expect(
      result.value.hypotheses[0]?.supportingEvidence[0],
    ).not.toHaveProperty('content');
  }
});

test('rejects an unsupported citation or definitive diagnosis in a summary', () => {
  for (const invalid of [
    { ...section, supportingEvidence: ['missing-source'] },
    { ...section, summary: 'You definitely have diabetes.' },
  ]) {
    expect(
      symptomSummaryTask.validateResult(
        { sections: [invalid] } as JsonValue,
        input,
      ).status,
    ).toBe('invalid');
  }
});

test('does not publish an English-only summary in the Korean symptom flow', () => {
  expect(
    symptomSummaryTask.validateResult(
      {
        sections: [
          {
            ...section,
            title: 'Recorded measurements',
            summary: 'The supplied records contain dated measurements.',
            uncertainty: 'The selected records are not a complete history.',
            missingData: ['Additional symptom records'],
          },
        ],
      } as JsonValue,
      input,
    ).status,
  ).toBe('invalid');
});

test('allows a factual summary without manufacturing uncertainty or missing information', () => {
  expect(
    symptomSummaryTask.validateResult(
      {
        sections: [
          {
            ...section,
            uncertainty: '',
            missingData: [],
          },
        ],
      } as JsonValue,
      input,
    ).status,
  ).toBe('valid');
});

test('keeps the uncertainty requirement for a disease assessment', () => {
  expect(
    validateDiseaseHypothesisResult(
      { hypotheses: [{ ...section, uncertainty: '' }] } as JsonValue,
      input,
    ).status,
  ).toBe('invalid');
});

test('keeps medical literature separate from personal record facts', () => {
  const external = {
    ...reference,
    sourceKind: 'external_medical' as const,
    sourceId: 'publication',
    evidenceId: 'publication',
  };
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        {
          ...section,
          supportingEvidence: [reference.evidenceId, external.evidenceId],
        },
      ],
    } as JsonValue,
    {
      ...input,
      evidence: {
        ...evidence,
        items: [
          ...evidence.items,
          { ...external, content: 'Synthetic medical literature.' },
        ],
      },
    },
  );
  expect(result).toMatchObject({
    status: 'invalid',
    reason: 'Keep record facts and medical context separate.',
  });
});
