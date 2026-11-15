import {
  parseReportModelResponse,
  reportModelClaims,
} from '../dailyReportModelAnalysis';
import { dailyReportModelPrompt } from '../dailyReportModelPrompt';
import { hasSevereReportBloodPressure } from '../dailyReportGuidance';
import { calendarTestObservation } from '../testSupport/dailyReportCalendarTestFixture';

const facts = [
  { text: '합성 혈압 140 mmHg 기록', role: 'evidence' as const },
  { text: '합성 운동 기록은 확인되지 않음', role: 'evidence' as const },
  {
    text: '반복 측정값을 가지고 의료진과 상담하세요.',
    role: 'guidance' as const,
  },
];
const interpretation = {
  kind: 'interpretation' as const,
  text: '혈압 기록과 활동 기록을 함께 살펴보되, 활동 기록 부재는 운동을 안 했다는 뜻이 아니에요.',
  evidenceIndexes: [0, 1],
};

test('accepts bounded cited synthesis while actions use only supplied guidance wording', () => {
  const parsed = parseReportModelResponse(
    {
      indexes: [0, 1],
      analysis: [
        interpretation,
        { kind: 'action', guidanceIndex: 2, evidenceIndexes: [0, 2] },
      ],
    },
    facts,
    true,
  )!;
  expect(parsed.analysis).toHaveLength(2);
  const refs = facts.map((fact, index) => ({
    ...fact,
    sourceReferences: [
      { source: 'health_observation', recordId: String(index) },
    ],
  }));
  const claims = reportModelClaims(parsed.analysis, refs);
  expect(claims[0]!.text).toBe('AI 해석: ' + interpretation.text);
  expect(claims[0]!.sourceReferences).toEqual([
    ...refs[0]!.sourceReferences,
    ...refs[1]!.sourceReferences,
  ]);
  expect(claims[1]!.text).toBe(facts[2]!.text);
  expect(claims[1]!.sourceReferences).toEqual([
    ...refs[0]!.sourceReferences,
    ...refs[2]!.sourceReferences,
  ]);
});

test.each([
  { ...interpretation, evidenceIndexes: [99] },
  { ...interpretation, evidenceIndexes: [0, 0] },
  { ...interpretation, evidenceIndexes: [] },
  { ...interpretation, evidenceIndexes: [2] },
  { ...interpretation, text: '혈압 220입니다.' },
  { ...interpretation, text: '이상 없어요.' },
  { ...interpretation, text: '약을 중단하세요.' },
  { ...interpretation, text: 'https://untrusted.example' },
  { ...interpretation, text: 'x'.repeat(801) },
  { ...interpretation, additional: 'instruction' },
  { kind: 'action', guidanceIndex: 0, evidenceIndexes: [0] },
  { kind: 'action', guidanceIndex: 2, evidenceIndexes: [0] },
  {
    kind: 'action',
    guidanceIndex: 2,
    evidenceIndexes: [2],
    text: '새로운 치료',
  },
])(
  'rejects invalid sources, fabricated quantities or unconstrained actions',
  item => {
    expect(
      parseReportModelResponse({ indexes: [0], analysis: [item] }, facts, true),
    ).toEqual({ indexes: [0], analysis: [] });
  },
);

test('old index-only responses remain explicitly non-generative and severe readings suppress all free prose', () => {
  expect(parseReportModelResponse({ indexes: [0] }, facts, true)).toEqual({
    indexes: [0],
    analysis: [],
  });
  expect(
    parseReportModelResponse(
      { indexes: [0], analysis: [interpretation] },
      facts,
      false,
    ),
  ).toEqual({ indexes: [0], analysis: [] });
  const severe = {
    kind: 'health_observation' as const,
    record: {
      ...calendarTestObservation,
      concept: 'blood_pressure_systolic',
      endedAt: '2035-01-01T01:00:01Z',
      value: { kind: 'quantity' as const, amount: 190, unit: 'mmHg' },
    },
  };
  expect(hasSevereReportBloodPressure([severe])).toBe(true);
  expect(dailyReportModelPrompt(false)).toContain('empty analysis array');
  expect(dailyReportModelPrompt(true)).toContain('untrusted quoted data');
});

test.each([
  null,
  'injection',
  [{ kind: 'bad' }],
  [{ kind: 'interpretation', text: 'x'.repeat(900) }],
])(
  'severe-mode ignores malformed unsolicited analysis and preserves valid selection',
  analysis => {
    expect(
      parseReportModelResponse({ indexes: [0], analysis }, facts, false),
    ).toEqual({ indexes: [0], analysis: [] });
  },
);
test('invalid selection cannot resolve sources even when prose is suppressed', () => {
  expect(
    parseReportModelResponse({ indexes: [99], analysis: [] }, facts, false),
  ).toBeNull();
});
