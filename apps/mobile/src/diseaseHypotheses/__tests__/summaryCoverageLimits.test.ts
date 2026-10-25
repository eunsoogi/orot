import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence, hypothesis, reference } from '../taskTestSupport';

const pressure =
  'health_observation: {"concept":"blood_pressure_systolic","value":{"kind":"quantity","amount":123,"unit":"mmHg"}}';
const section = (summary: string) =>
  hypothesis({
    summary,
    supportingEvidence: [reference.evidenceId],
    uncertainty: '',
    missingData: [],
  });
const measured = section('수축기 혈압은 123 mmHg로 기록됐어요.');
const limitation = section(
  '제공된 자료에는 주관적 증상에 관한 구체적인 기록이 없습니다.',
);
const note = 'no_symptom_entries_in_supplied_records';
function validate(
  sections: ReturnType<typeof section>[],
  coverageNotes: unknown = [note],
  extraContent?: string,
  sourceKind = 'personal_record' as 'personal_record' | 'reviewed_memory',
) {
  return symptomSummaryTask.validateResult(
    { sections, coverageNotes } as never,
    {
      request: '기록 요약',
      evidence: {
        ...evidence,
        items: [
          { ...reference, content: pressure },
          ...(extraContent
            ? [
                {
                  ...reference,
                  evidenceId: 'extra',
                  sourceId: 'extra',
                  sourceKind,
                  content: extraContent,
                },
              ]
            : []),
        ],
      },
    },
  );
}

test('maps a verified structured coverage note into existing uncertainty without inventing missing app records', () => {
  const result = validate([measured]);
  expect(result.status).toBe('valid');
  if (result.status === 'valid') {
    expect(result.value.hypotheses).toHaveLength(1);
    expect(result.value.hypotheses[0]?.summary).toBe(measured.summary);
    expect(result.value.hypotheses[0]?.uncertainty).toContain(
      '이번 요약에 제공된 기록',
    );
    expect(result.value.hypotheses[0]?.uncertainty).not.toContain('앱에');
  }
  expect(validate([limitation]).status).toBe('invalid');
});

test('does not turn unqualified app absence, absent symptoms or empty promises into coverage facts', () => {
  for (const text of [
    '앱에는 증상 기록이 전혀 없습니다.',
    '제공된 자료에는 증상이 없습니다.',
    '건강 측정 기록은 다음과 같습니다.',
    '제공된 자료에는 증상 기록이 없습니다. 앱에도 증상이 없습니다.',
  ])
    expect(validate([measured, section(text)], []).status).toBe('invalid');
  expect(validate([measured], ['private-custom-note']).status).toBe('invalid');
  expect(validate([measured], [note, note]).status).toBe('invalid');
});

test('rejects the limitation when supplied symptom facts or untyped source prose prevent proving it', () => {
  expect(
    validate(
      [measured],
      [note],
      'symptom_entry: {"description":"Synthetic symptom"}',
    ).status,
  ).toBe('invalid');
  expect(
    validate([measured], [note], 'Synthetic original source prose.').status,
  ).toBe('invalid');
  expect(
    validate(
      [measured],
      [note],
      'Synthetic reviewed memory.',
      'reviewed_memory',
    ).status,
  ).toBe('invalid');
  expect(validate([measured], [note], pressure, 'reviewed_memory').status).toBe(
    'invalid',
  );
});

test('preserves existing uncertainty and keeps the saved-field length bound without truncating text', () => {
  const original = {
    ...measured,
    uncertainty: '조회된 일부 구간만 확인했어요.',
  };
  const result = validate([original]);
  expect(result.status).toBe('valid');
  if (result.status === 'valid')
    expect(result.value.hypotheses[0]?.uncertainty).toMatch(
      /^조회된 일부 구간만 확인했어요\.\n이번 요약에 제공된 기록/u,
    );
  expect(original.uncertainty).toBe('조회된 일부 구간만 확인했어요.');
  expect(
    validate([{ ...measured, uncertainty: '가'.repeat(490) }]).status,
  ).toBe('invalid');
});
