import type { TaskResponderInput } from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import { partitionedSymptomSummaryTask as task } from '../partitionedSymptomSummaryTask';
import { statisticSourcePeriod } from '../computedStatisticChoice';
import { computedSummaryLimitations } from '../computedSummaryLimitations';
import { reference } from '../taskTestSupport';

test.each([
  [
    'quantity_sensor_series_limit_reached',
    {
      topic: 'measurements',
      quantities: [
        { concept: 'heart_rate', unit: 'bpm', meanOfRecordedDailyMeans: 70 },
      ],
    },
    { q0: 'mean' },
    '측정 출처 수',
  ],
  [
    'medication_catalog_limit_reached',
    {
      topic: 'medications',
      medications: [
        { name: '합성약', source: 'healthkit_registration', taken: 1 },
      ],
    },
    { m0: 'status' },
    '복용약',
  ],
  [
    'unsupported_sleep_categories_excluded_from_duration',
    { topic: 'sleep', sleep: { meanRecordedDailyMinutes: 420 } },
    { sleep: 'mean' },
    '수면',
  ],
] as const)(
  'preserves the supplied aggregate limitation %s in saved-result uncertainty',
  (code, facts, selection, label) => {
    const input: TaskResponderInput = {
      request: '기록 사실 요약',
      resultPartition: { sourceKind: 'personal_record', index: 0, total: 2 },
      evidence: {
        items: [
          {
            ...reference,
            evidenceId: 'facts',
            content:
              'health_context: ' +
              JSON.stringify({ ...facts, limitations: [code] }),
          },
        ],
        coverage: [],
        conflicts: [],
      },
    };
    const generated = { recordSummaries: { facts: selection as JsonObject } };
    const result = task.validateResult(generated, input);
    expect(result.status).toBe('valid');
    if (result.status !== 'valid') throw new Error('Expected bounded summary');
    expect(result.value.hypotheses[0].uncertainty).toMatch(
      /(?:일부|제외|제한)/u,
    );
    expect(result.value.hypotheses[0].uncertainty).not.toContain(code);
    expect(result.value.hypotheses[0].uncertainty).toContain(label);
    const merged = task.finalResultPartition!.mergeValues([generated], input);
    const accepted = task.validateResult(merged, {
      ...input,
      resultPartition: undefined,
    });
    expect(accepted.status).toBe('valid');
    if (accepted.status !== 'valid') throw new Error('Expected merged limits');
    expect(accepted.value.hypotheses[0].uncertainty).toBe(
      result.value.hypotheses[0].uncertainty,
    );
    expect(
      task.projectStreamedText!(
        JSON.stringify({
          type: 'result',
          value: generated,
          citations: ['facts'],
        }),
        input,
      ),
    ).toContain(label);
  },
);

test('does not invent limits or expose unknown internal codes as user text', () => {
  expect(
    computedSummaryLimitations({ topic: 'measurements', limitations: [] }),
  ).toEqual([]);
  expect(
    computedSummaryLimitations({
      topic: 'measurements',
      limitations: ['unknown_internal_limit'],
    }),
  ).toEqual([
    '이 집계에는 추가적인 범위 제한이 있어요. 근거에서 원본의 집계 범위를 확인해 주세요.',
  ]);
  const notes = computedSummaryLimitations({
    topic: 'activity',
    limitations: [
      'unrecorded_days_are_unknown_not_zero_or_missed_doses',
      'medication_registration_and_current_confirmation_are_distinct_from_individual_dose_completion',
    ],
  });
  expect(notes.join(' ')).not.toMatch(/복약|복용|약의/u);
});

test('an exact midnight exclusive endpoint does not add the next calendar date', () => {
  const text = statisticSourcePeriod({
    period: {
      fromInclusive: '2026-10-01T00:00:00Z',
      toExclusive: '2026-10-02T00:00:00Z',
      timeZone: 'UTC',
    },
  });
  expect(text).toBe('집계 기간 2026-10-01 ~ 2026-10-01 (UTC).');
});

test('period display includes a partial day after a sub-millisecond exclusive endpoint', () => {
  const text = statisticSourcePeriod({
    period: {
      fromInclusive: '2026-10-01T00:00:00.0005Z',
      toExclusive: '2026-10-02T00:00:00.0005Z',
      timeZone: 'UTC',
    },
  });
  expect(text).toContain('2026-10-01 ~ 2026-10-02');
  expect(text).toContain('하루 중 일부만 포함');
});

test('a nonempty source period within one millisecond is not discarded', () => {
  expect(
    statisticSourcePeriod({
      period: {
        fromInclusive: '2026-10-01T00:00:00.0001Z',
        toExclusive: '2026-10-01T00:00:00.0005Z',
        timeZone: 'UTC',
      },
    }),
  ).toContain('2026-10-01 ~ 2026-10-01');
});
