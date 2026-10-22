import { NativeModules } from 'react-native';
import { symptomSummaryTask } from '../symptomSummaryTask';
import { evidence, hypothesis, reference } from '../taskTestSupport';

afterEach(() => {
  delete NativeModules.OrotProviderDiagnostics;
});

test('identifies only the bounded section position when a personal citation has no record fact', () => {
  const report = jest.fn();
  NativeModules.OrotProviderDiagnostics = { report };
  const result = symptomSummaryTask.validateResult(
    {
      sections: [
        hypothesis({
          summary: '합성약이 등록되어 있어요.',
          supportingEvidence: [reference.evidenceId],
          uncertainty: '',
          missingData: [],
        }),
        hypothesis({
          summary: '연구에서 운동의 일반적 영향을 설명했어요.',
          supportingEvidence: [reference.evidenceId],
          uncertainty: '',
          missingData: [],
        }),
      ],
    },
    {
      request: '합성 기록',
      evidence: {
        ...evidence,
        items: [
          {
            ...reference,
            content: 'medication_definition: {"displayText":"합성약"}',
          },
        ],
      },
    },
  );
  expect(result.status).toBe('invalid');
  expect(report).toHaveBeenCalledWith(
    'disease',
    'validation',
    'task_summary_empty_section_2',
  );
  const correction = symptomSummaryTask.correctionInstructionForInvalidResult!(
    'Replace empty section headings with cited concrete facts.',
  );
  expect(correction).toContain(
    'personal_record must state a concrete fact from that exact source',
  );
  expect(correction).toContain(
    'external_medical sources only, never personal records',
  );
  expect(JSON.stringify(report.mock.calls)).not.toMatch(
    /합성약|연구|evidence-1/u,
  );
});

test.each([
  ['body_mass', 'task_summary_facts_body_mass'],
  ['heart_rate', 'task_summary_facts_heart_rate'],
  ['blood pressure systolic', 'task_summary_facts_pressure'],
  ['step_count', 'task_summary_facts_activity'],
  ['private-custom-concept', 'task_summary_facts_other_quantity'],
])(
  'reports only a closed topic when %s facts are omitted',
  (concept, expected) => {
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { report };
    const result = symptomSummaryTask.validateResult(
      {
        sections: [
          hypothesis({
            summary: '측정 기록은 다음과 같습니다.',
            supportingEvidence: [reference.evidenceId],
            uncertainty: '',
            missingData: [],
          }),
        ],
      },
      {
        request: '기록 요약',
        evidence: {
          ...evidence,
          items: [
            {
              ...reference,
              content: `health_observation: ${JSON.stringify({ concept, value: { kind: 'quantity', amount: 123.45, unit: 'synthetic-unit' } })}`,
            },
          ],
        },
      },
    );
    expect(result.status).toBe('invalid');
    expect(report).toHaveBeenCalledWith('disease', 'validation', expected);
    expect(JSON.stringify(report.mock.calls)).not.toMatch(
      /123\.45|private-custom-concept|synthetic-unit|evidence-1/u,
    );
  },
);

test.each([
  ['completion', { summary: '예시약을 복용했어요.' }],
  ['unknown', { uncertainty: '복용 여부는 알 수 없어요.' }],
  ['missing_data', { missingData: ['복용 여부'] }],
])(
  'distinguishes medication %s without exposing the rejected prose',
  (category, override) => {
    const report = jest.fn();
    NativeModules.OrotProviderDiagnostics = { report };
    const result = symptomSummaryTask.validateResult(
      {
        sections: [
          hypothesis({
            summary: '예시약이 등록됐어요.',
            supportingEvidence: [reference.evidenceId],
            uncertainty: '',
            missingData: [],
            ...override,
          }),
        ],
      },
      {
        request: '합성 기록 요약',
        evidence: {
          ...evidence,
          items: [
            {
              ...reference,
              content:
                'health_overview: {"topic":"medications","records":[{"kind":"medication_definition","displayText":"예시약","hasSchedule":true}]}',
            },
          ],
        },
      },
    );
    expect(result.status).toBe('invalid');
    expect(report).toHaveBeenCalledWith(
      'disease',
      'validation',
      `task_summary_medication_${category}`,
    );
    expect(JSON.stringify(report.mock.calls)).not.toMatch(
      /예시약|복용|evidence-1/u,
    );
  },
);
