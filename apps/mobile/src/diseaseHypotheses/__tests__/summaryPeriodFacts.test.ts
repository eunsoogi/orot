import { summaryFactIssue } from '../summaryFactValidation';
import { healthContextContent } from '../../aiFeatures/integration/healthContextEvidence';
import { healthContextDays } from '../../healthEvidence/healthContext/window';
import type {
  HealthContextReport,
  HealthContextTopic,
} from '../../healthEvidence/healthContext/types';
import { reference, hypothesis } from '../taskTestSupport';
import {
  applySummaryCoverageNotes,
  SUMMARY_SYMPTOM_COVERAGE_NOTE,
} from '../summaryCoverageNotes';

const window = {
  fromInclusive: '2026-10-01T00:00:00Z',
  toExclusive: '2026-10-02T00:00:00Z',
  timeZone: 'UTC',
};
const report: HealthContextReport = {
  window,
  days: healthContextDays(window),
  quantities: [],
  medications: [],
  sleep: [],
  symptoms: { entryCount: 0, recordedDays: 0, latest: [] },
  limitations: [],
  mutationGeneration: 1,
  deletionGeneration: 0,
};
function issue(
  summary: string,
  topic: HealthContextTopic,
  input: HealthContextReport,
) {
  return summaryFactIssue(
    {
      hypotheses: [
        hypothesis({
          summary,
          supportingEvidence: [reference],
          uncertainty: '',
          missingData: [],
        }),
      ],
    },
    [
      {
        ...reference,
        content: healthContextContent(
          { kind: 'health_context_period', version: 1, topic, window },
          input,
        ),
      },
    ],
  );
}

test('period activity keeps the same step unit guard as original samples', () => {
  const activity = {
    ...report,
    quantities: [
      {
        concept: 'step_count',
        unit: 'count',
        source: 'synthetic',
        days: [
          {
            date: '2026-10-01',
            samples: 1,
            minimum: 500,
            maximum: 500,
            mean: 500,
            sum: 500,
            latest: 500,
            firstAt: window.fromInclusive,
            lastAt: window.fromInclusive,
          },
        ],
      },
    ],
  };
  expect(
    issue('걸음 수는 500걸음이에요.', 'activity', activity),
  ).toBeUndefined();
  expect(issue('걸음 수는 500회예요.', 'activity', activity)).toBe('step_unit');
});

test('accepts equivalent readable sleep means and rejects a different duration', () => {
  const sleep = {
    ...report,
    sleep: [
      {
        date: '2026-10-01',
        asleepSeconds: 5400,
        stages: { asleepCore: 5400 },
        sampleCount: 1,
        overlappingStageSeconds: 0,
      },
    ],
  };
  expect(
    issue('기록된 날짜의 평균 수면은 90분이에요.', 'sleep', sleep),
  ).toBeUndefined();
  expect(
    issue('기록된 날짜의 평균 수면은 1시간 30분이에요.', 'sleep', sleep),
  ).toBeUndefined();
  expect(issue('기록된 날짜의 평균 수면은 2시간이에요.', 'sleep', sleep)).toBe(
    'facts_sleep',
  );
  expect(issue('기록된 날짜의 평균 수면은 190분이에요.', 'sleep', sleep)).toBe(
    'facts_sleep',
  );
  expect(
    issue('기록된 날짜의 평균 수면은 11시간 30분이에요.', 'sleep', sleep),
  ).toBe('facts_sleep');
});

test('checks absence of supplied symptom entries using an explicit period count, never from omitted raw samples', () => {
  const analysis = {
    hypotheses: [
      hypothesis({
        summary: '기간 내 증상 기록은 0건이에요.',
        supportingEvidence: [reference],
      }),
    ],
  };
  const verify = (entryCount: number) =>
    applySummaryCoverageNotes(
      analysis,
      [SUMMARY_SYMPTOM_COVERAGE_NOTE],
      [
        {
          ...reference,
          content: healthContextContent(
            {
              kind: 'health_context_period',
              version: 1,
              topic: 'symptoms',
              window,
            },
            {
              ...report,
              symptoms: { entryCount, recordedDays: entryCount, latest: [] },
            },
          ),
        },
      ],
    );
  expect(verify(0).status).toBe('valid');
  expect(verify(1).status).toBe('invalid');
});
