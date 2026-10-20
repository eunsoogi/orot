import { visitHealthFixture } from '../testing/healthContextFixture';
import { hasUnsupportedDateOrValue } from '../questionFacts';
import { periodQuestionQuantityFacts } from '../periodQuestionFacts';
import { runVisitQuestionWorkflow } from '../workflow';
import { makeProvider, selectedOption } from '../testing/workflowFixtures';
import { restoreVisitQuestionHealthContext } from '../../../aiFeatures/integration/savedVisitQuestionHealthContext';
import { LocalEvidenceReferenceRegistry } from '../../../aiFeatures/integration/evidenceRegistry';

test.each([
  [{ calendarDays: 31 }, 31],
  [{ quantities: [{ missingCalendarDays: 29 }] }, 29],
  [{ quantities: [{ comparison: { previousRecordedDays: 6 } }] }, 6],
  [{ quantities: [{ comparison: { recentRecordedDays: 5 } }] }, 5],
  [{ sleep: { missingCalendarDays: 23 } }, 23],
])(
  'pairs a closed app-computed coverage count with days: %j',
  (value, amount) => {
    expect(periodQuestionQuantityFacts(value)).toContainEqual({
      amount,
      unit: '일',
    });
  },
);

test('does not turn arbitrary numeric fields or measurement values into day counts', () => {
  const facts = periodQuestionQuantityFacts({
    unknownCount: 93,
    quantities: [{ unit: 'count/min', minimumSample: 57, sensorSeries: 94 }],
    sleep: { unknownCount: 95 },
  });
  expect(facts).toEqual([{ amount: 57, unit: 'count/min' }]);
});

test.each([-1, 1.25, '4', null, Number.NaN, Number.POSITIVE_INFINITY])(
  'does not authorize a malformed calendar-day count: %p',
  calendarDays => {
    expect(periodQuestionQuantityFacts({ calendarDays })).toEqual([]);
  },
);

test.each([
  'measurements',
  'activity',
  'sleep',
  'medications',
  'symptoms',
] as const)(
  'accepts the real %s projection period length without authorizing an invented count or wrong unit',
  async topic => {
    const f = await visitHealthFixture(topic);
    try {
      expect(f.report.days).toHaveLength(4);
      expect(
        hasUnsupportedDateOrValue('조회 기간 4일을 어떻게 참고할까요?', [
          f.item,
        ]),
      ).toBe(false);
      expect(
        hasUnsupportedDateOrValue('조회 기간 9일을 어떻게 참고할까요?', [
          f.item,
        ]),
      ).toBe(true);
      expect(
        hasUnsupportedDateOrValue('측정값 4mg을 어떻게 참고할까요?', [f.item]),
      ).toBe(true);
    } finally {
      f.close();
    }
  },
);

test('validates a provider response and saves and restores actual period coverage without correction', async () => {
  const f = await visitHealthFixture();
  try {
    // One synthetic observation on one of four calendar days independently establishes three unknown days.
    expect(f.report.days).toHaveLength(4);
    expect(f.report.quantities[0]?.days).toHaveLength(1);
    const questions = [
      '조회 기간 4일의 심박수 기록으로 진료에서 어떤 점을 확인하면 좋을까요?',
      '심박수 기록이 없는 3일은 다음 진료에서 어떻게 설명하면 좋을까요?',
      '심박수 측정 조건과 함께 어떤 증상 변화를 준비하면 좋을까요?',
    ];
    // The provider is synthetic; aggregation, validation, transactional storage and restoration are real.
    const { provider, requests } = makeProvider([
      JSON.stringify({
        type: 'result',
        citations: ['evidence-1'],
        value: {
          status: 'suggestions',
          questions: questions.map(questionText => ({
            questionText,
            rationale:
              '기간별 심박수 기록의 범위를 의료진과 함께 확인할 수 있어요.',
            priority: 'routine',
            evidenceIds: ['evidence-1'],
          })),
        },
      }),
    ]);
    const { selection, option } = selectedOption(provider, 'on-device');
    const result = await runVisitQuestionWorkflow({
      prepared: {
        ...f.prepared,
        evidence: {
          ...f.prepared.evidence,
          batch: {
            items: [f.item],
            coverage: [
              {
                sourceKind: 'personal_record',
                searchedSourceIds: [f.item.sourceId],
                gaps: [],
                truncated: false,
                resultLimit: 1,
                returnedCount: 1,
              },
            ],
            conflicts: [],
          },
        },
      },
      selection,
      providerOptions: [option],
    });
    expect(result.status).toBe('ready');
    expect(requests).toHaveLength(1);
    if (result.status !== 'ready')
      throw new Error('Supported period questions were rejected.');
    expect(result.questions.map(question => question.questionText)).toEqual(
      questions,
    );
    await f.save({ questions: result.questions });
    const rows = await f.records.list('visit_question');
    expect(rows.map(row => row.questionText)).toEqual(questions);
    const restored = await restoreVisitQuestionHealthContext(
      rows[0]!.healthContextSources![0]!,
      f.read,
      new LocalEvidenceReferenceRegistry(),
    );
    for (const question of questions)
      expect(hasUnsupportedDateOrValue(question, [restored])).toBe(false);
    expect(
      hasUnsupportedDateOrValue('기록이 없는 9일을 어떻게 설명할까요?', [
        restored,
      ]),
    ).toBe(true);
  } finally {
    f.close();
  }
});
