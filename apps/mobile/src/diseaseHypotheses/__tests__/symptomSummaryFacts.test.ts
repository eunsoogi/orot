import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence, hypothesis, reference } from '../taskTestSupport';

function validate(summary: string, content: string, overrides = {}) {
  return symptomSummaryTask.validateResult(
    {
      sections: [
        hypothesis({
          summary,
          supportingEvidence: [reference.evidenceId],
          uncertainty: '',
          missingData: [],
          ...overrides,
        }),
      ],
    },
    {
      request: '기록 사실 요약',
      evidence: { ...evidence, items: [{ ...reference, content }] },
    },
  );
}

const pressure =
  'health_observation: {"concept":"blood pressure systolic","value":{"kind":"quantity","amount":123,"unit":"mmHg"}}';
const medication =
  'health_overview: {"topic":"medications","records":[{"kind":"medication_definition","displayText":"예시약","hasSchedule":true}]}';

test.each([true, false])(
  'does not infer prescription from a registered schedule (%s)',
  hasSchedule => {
    const content = medication.replace('true', String(hasSchedule));
    expect(validate('예시약은 처방됨.', content).status).toBe('invalid');
    expect(validate('예시약은 처방되지 않음.', content).status).toBe('invalid');
    expect(validate('예시약이 건강 앱에 등록됐어요.', content).status).toBe(
      'valid',
    );
  },
);

test('preserves an explicit prescription assertion and a qualified catalog limitation', () => {
  const prescribed =
    'health_overview: {"topic":"medications","records":[{"kind":"medication_definition","displayText":"예시약","hasSchedule":true},{"kind":"medication_assertion","medicationName":"예시약","assertionKind":"prescribed"}]}';
  expect(validate('예시약은 처방됨.', prescribed).status).toBe('valid');
  expect(
    validate(
      '예시약이 등록됐어요. 일정 등록이 처방 여부를 뜻하지는 않아요.',
      medication,
    ).status,
  ).toBe('valid');
});

test('does not turn a categorical sleep stage into an episode count', () => {
  const content =
    'health_overview: {"topic":"sleep","records":[{"kind":"health_observation","concept":"HKCategoryTypeIdentifierSleepAnalysis","value":{"kind":"text","text":"3"},"sourceSemantics":{"sleepStage":"코어 수면","intervalScope":"single_sample_not_nightly_total","intervalDurationSeconds":300}}]}';
  expect(validate('코어 수면 3회 (300초).', content).status).toBe('invalid');
  expect(validate('코어 수면 구간은 5분이에요.', content).status).toBe('valid');
});

test('does not publish a cited placeholder instead of the actual measured value', () => {
  expect(validate('건강 측정 기록은 다음과 같습니다.', pressure).status).toBe(
    'invalid',
  );
  expect(
    validate('수축기 혈압은 123 mmHg로 기록됐어요.', pressure).status,
  ).toBe('valid');
});

test('normalizes numeric punctuation but requires a fact for every cited measured concept', () => {
  const content =
    'health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"step_count","value":{"kind":"quantity","amount":1234,"unit":"count"}},{"kind":"health_observation","concept":"heart_rate","value":{"kind":"quantity","amount":76,"unit":"count/min"}}]}';
  expect(
    validate('걸음은 1,234걸음이고 심박수는 76회/분이에요.', content).status,
  ).toBe('valid');
  expect(validate('걸음은 1,234걸음이에요.', content).status).toBe('invalid');
});

test('allows measurements from one source group to be explained in separate cited sections', () => {
  const content =
    'health_overview: {"topic":"measurements","records":[{"kind":"health_observation","concept":"blood_pressure_systolic","value":{"kind":"quantity","amount":123,"unit":"mmHg"}},{"kind":"health_observation","concept":"heart_rate","value":{"kind":"quantity","amount":76,"unit":"count/min"}}]}';
  const input = {
    request: '기록 요약',
    evidence: { ...evidence, items: [{ ...reference, content }] },
  };
  const sections = [
    '수축기 혈압은 123 mmHg예요.',
    '심박수는 76회/분이에요.',
  ].map(summary =>
    hypothesis({
      summary,
      supportingEvidence: [reference.evidenceId],
      uncertainty: '',
      missingData: [],
    }),
  );
  expect(symptomSummaryTask.validateResult({ sections }, input).status).toBe(
    'valid',
  );
  expect(
    symptomSummaryTask.validateResult({ sections: sections.slice(0, 1) }, input)
      .status,
  ).toBe('invalid');
  expect(
    symptomSummaryTask.validateResult(
      {
        sections: [
          ...sections,
          { ...sections[0]!, summary: '측정 기록은 다음과 같습니다.' },
        ],
      },
      input,
    ).status,
  ).toBe('invalid');
  const separate = {
    ...reference,
    evidenceId: 'separate-heart-source',
    content:
      'health_observation: {"concept":"heart_rate","value":{"kind":"quantity","amount":76,"unit":"count/min"}}',
  };
  expect(
    symptomSummaryTask.validateResult(
      {
        sections: [
          sections[0]!,
          { ...sections[1]!, supportingEvidence: [separate.evidenceId] },
        ],
      },
      {
        ...input,
        evidence: {
          ...input.evidence,
          items: [...input.evidence.items, separate],
        },
      },
    ).status,
  ).toBe('invalid');
});

test('preserves registration versus dose completion for grouped medication evidence', () => {
  expect(validate('예시약이 건강 앱에 등록됐어요.', medication).status).toBe(
    'valid',
  );
  expect(validate('예시약을 복용했어요.', medication).status).toBe('invalid');
  expect(
    validate('등록된 복약 기록은 다음과 같습니다.', medication).status,
  ).toBe('invalid');
  expect(
    validate('예시약이 등록됐어요.', medication, {
      missingData: ['복용 여부', '복용 일정'],
    }).status,
  ).toBe('invalid');
});

test('does not claim normalized units are unavailable because the original display was absent', () => {
  expect(
    validate('수축기 혈압은 123으로 기록됐어요.', pressure, {
      uncertainty: '정확한 단위는 제공되지 않음',
    }).status,
  ).toBe('invalid');
});

test('requires a source sleep stage rather than an empty sleep heading', () => {
  const content =
    'health_overview: {"topic":"sleep","records":[{"kind":"health_observation","concept":"HKCategoryTypeIdentifierSleepAnalysis","value":{"kind":"text","text":"4"},"sourceSemantics":{"sleepStage":"깊은 수면","intervalDurationSeconds":300}}]}';
  expect(validate('수면 기록은 다음과 같습니다.', content).status).toBe(
    'invalid',
  );
  expect(validate('개별 구간에 깊은 수면이 기록됐어요.', content).status).toBe(
    'valid',
  );
});

test('keeps unknown individual dose completion separate from known registered medication use', () => {
  expect(
    validate('예시약이 등록됐어요.', medication, {
      uncertainty: '복용 여부는 알 수 없어요.',
    }).status,
  ).toBe('invalid');
  expect(
    validate(
      '예시약이 등록됐어요. 개별 복용 완료는 확인할 수 없어요.',
      medication,
    ).status,
  ).toBe('valid');
});

test('does not mistake a negated confirmation for confirmed dose completion', () => {
  expect(
    validate(
      '예시약이 등록됐어요. 이 기록은 개별 복용 완료를 확인하지는 않습니다.',
      medication,
    ).status,
  ).toBe('valid');
  expect(
    validate('예시약의 개별 복용 완료를 확인했습니다.', medication).status,
  ).toBe('invalid');
  expect(
    validate(
      '예시약이 등록됐어요. 이는 개별 복용 완료 기록을 뜻하지 않습니다.',
      medication,
    ).status,
  ).toBe('valid');
  expect(validate('예시약 복용 완료.', medication).status).toBe('invalid');
  expect(validate('예시약 복용 완료 확인.', medication).status).toBe('invalid');
});
