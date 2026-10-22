import { visitHealthFixture } from '../testing/healthContextFixture';
import { healthObservation } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
import { LocalEvidenceReferenceRegistry } from '../../../aiFeatures/integration/evidenceRegistry';
import {
  registerHealthContextEvidence,
  healthContextContent,
} from '../../../aiFeatures/integration/healthContextEvidence';
import { saveVisitQuestionRoute } from '../../../aiFeatures/integration/visitQuestionsRouteSave';
import { restoreVisitQuestionHealthContext } from '../../../aiFeatures/integration/savedVisitQuestionHealthContext';
import { hasUnsupportedDateOrValue } from '../questionFacts';

/** Exercise the actual fresh-context route and transactional save, not a pre-captured summary fixture. */
async function routeFixture(detail: 'weekly' | 'daily') {
  const f = await visitHealthFixture();
  for (const [index, date, amount] of [
    [1, '2026-09-12T01:00:00Z', 70],
    [2, '2026-09-12T02:00:00Z', 80],
    [3, '2026-09-20T01:00:00Z', 90],
    [4, '2026-09-20T02:00:00Z', 100],
  ] as const) {
    await f.records.put('health_observation', {
      ...healthObservation(`synthetic-period-${index}`, 'heart_rate', date),
      value: { kind: 'quantity', amount, unit: 'count/min' },
    });
  }
  const scope = {
    kind: 'health_context_period' as const,
    version: 1 as const,
    topic: 'measurements' as const,
    window: {
      fromInclusive: '2026-09-11T00:00:00Z',
      toExclusive: '2026-10-02T00:00:00Z',
      timeZone: 'UTC',
    },
  };
  const report = await f.read(scope.window, [scope.topic]);
  const registry = new LocalEvidenceReferenceRegistry();
  const alias = registerHealthContextEvidence({
    registry,
    read: f.read,
    scope,
    report,
    detail,
  });
  const item = { ...registry.resolve(alias)!, content: alias.content };
  const questionText =
    detail === 'weekly'
      ? '주 평균 심박수 75회/분의 변화를 어떻게 확인할까요?'
      : '9월 12일 평균 심박수 75회/분을 어떻게 확인할까요?';
  // The target value is absent from summary min/max/latest/comparison: a summary-only fixture cannot prove this repair.
  expect(
    hasUnsupportedDateOrValue(questionText, [
      { ...item, content: healthContextContent(scope, report) },
    ]),
  ).toBe(true);
  expect(hasUnsupportedDateOrValue(questionText, [item])).toBe(false);
  const save = (text = questionText) =>
    saveVisitQuestionRoute(
      {
        appointment: f.prepared.appointment,
        questions: [{ ...f.question, questionText: text, citations: [item] }],
        caveats: [],
        resolveSource: () => item,
      },
      async () => ({
        prepareUpcomingVisitQuestionContext: async () => ({
          ...f.prepared,
          saveReviewedQuestions: questions => f.save({ questions }),
        }),
      }),
    );
  return { ...f, saveRoute: save, questionText };
}

test.each(['weekly', 'daily'] as const)(
  'saves and restores a legitimate %s value absent from the summary through the real route',
  async detail => {
    const f = await routeFixture(detail);
    try {
      const result = await f.saveRoute();
      expect(result.questions[0]?.questionText).toBe(f.questionText);
      const rows = await f.records.list('visit_question');
      expect(rows).toHaveLength(1);
      const restored = await restoreVisitQuestionHealthContext(
        rows[0]!.healthContextSources![0]!,
        f.read,
        new LocalEvidenceReferenceRegistry(),
      );
      expect(hasUnsupportedDateOrValue(f.questionText, [restored])).toBe(false);
    } finally {
      f.close();
    }
  },
);

test('rejects fabricated period values and changed originals without replacing a saved list', async () => {
  const f = await routeFixture('weekly');
  try {
    await f.saveRoute();
    const previous = await f.records.list('visit_question');
    await expect(
      f.saveRoute('주 평균 심박수 77회/분을 어떻게 확인할까요?'),
    ).rejects.toThrow('does not support');
    expect(await f.records.list('visit_question')).toEqual(previous);
    await f.records.put('health_observation', {
      ...f.observation,
      value: { kind: 'quantity', amount: 81, unit: 'count/min' },
    });
    await expect(f.saveRoute()).rejects.toThrow('changed');
    expect(await f.records.list('visit_question')).toEqual(previous);
  } finally {
    f.close();
  }
});
